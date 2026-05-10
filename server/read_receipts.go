package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/pkg/errors"
)

const (
	readReceiptKVPrefix      = "readrec_v1_"
	maxReadReceiptPostIDs    = 80
	readReceiptMergeMaxRetry = 16
)

type readReceiptDoc struct {
	Readers map[string]int64 `json:"readers"`
}

func readReceiptKVKey(postID string) string {
	return readReceiptKVPrefix + postID
}

func kvMissing(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") ||
		strings.Contains(msg, "does not exist") ||
		strings.Contains(msg, "no entry")
}

func (p *Plugin) getReadReceiptDoc(postID string) (readReceiptDoc, error) {
	key := readReceiptKVKey(postID)
	var doc readReceiptDoc
	err := p.client.KV.Get(key, &doc)
	if err != nil {
		if kvMissing(err) {
			return readReceiptDoc{Readers: map[string]int64{}}, nil
		}
		return readReceiptDoc{}, errors.Wrap(err, "kv get read receipt")
	}
	if doc.Readers == nil {
		doc.Readers = map[string]int64{}
	}
	return doc, nil
}

func (p *Plugin) mergeReadReceiptReader(postID, readerID string, readAt int64) error {
	key := readReceiptKVKey(postID)
	for attempt := 0; attempt < readReceiptMergeMaxRetry; attempt++ {
		doc, err := p.getReadReceiptDoc(postID)
		if err != nil {
			return err
		}
		if prev, ok := doc.Readers[readerID]; ok && prev >= readAt {
			return nil
		}
		doc.Readers[readerID] = readAt
		if _, setErr := p.client.KV.Set(key, &doc); setErr != nil {
			time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
			continue
		}
		return nil
	}
	return errors.New("merge read receipt: contention limit")
}

func (p *Plugin) publishReadReceiptEvent(postChannelID, postID, readerID string, readAt int64) {
	payload := map[string]any{
		"post_id":   postID,
		"reader_id": readerID,
		"read_at":   strconv.FormatInt(readAt, 10),
	}
	broadcast := &model.WebsocketBroadcast{
		ChannelId: postChannelID,
	}
	p.API.PublishWebSocketEvent("read_receipt_updated", payload, broadcast)
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (p *Plugin) recordReadReceipt(readerID, postID string, readAt int64) error {
	post, appErr := p.API.GetPost(postID)
	if appErr != nil {
		return appErr
	}
	if post.DeleteAt > 0 {
		return errors.New("deleted post")
	}
	if post.UserId == readerID {
		return errors.New("skip author")
	}
	if _, appErr := p.API.GetChannelMember(post.ChannelId, readerID); appErr != nil {
		return appErr
	}
	if err := p.mergeReadReceiptReader(post.Id, readerID, readAt); err != nil {
		return err
	}
	p.publishReadReceiptEvent(post.ChannelId, post.Id, readerID, readAt)
	return nil
}

func (p *Plugin) handleMarkReadReceipts(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	var body struct {
		PostIDs []string `json:"post_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if len(body.PostIDs) > maxReadReceiptPostIDs {
		http.Error(w, "too many posts", http.StatusBadRequest)
		return
	}

	readAt := time.Now().UnixMilli()
	seen := make(map[string]bool)
	for _, postID := range body.PostIDs {
		postID = strings.TrimSpace(postID)
		if postID == "" || seen[postID] {
			continue
		}
		seen[postID] = true
		if err := p.recordReadReceipt(userID, postID, readAt); err != nil {
			p.API.LogDebug("recordReadReceipt skipped",
				"post_id", postID,
				"reader_id", userID,
				"error", err.Error(),
			)
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (p *Plugin) handleGetReadReceipts(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	raw := strings.TrimSpace(r.URL.Query().Get("post_ids"))
	if raw == "" {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"receipts": map[string]map[string]int64{},
		})
		return
	}

	parts := strings.Split(raw, ",")
	seen := make(map[string]bool)
	var ids []string
	for _, part := range parts {
		id := strings.TrimSpace(part)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
		if len(ids) >= maxReadReceiptPostIDs {
			break
		}
	}

	out := make(map[string]map[string]int64)
	for _, postID := range ids {
		post, appErr := p.API.GetPost(postID)
		if appErr != nil {
			continue
		}
		if post.UserId != userID {
			continue
		}
		if _, appErr := p.API.GetChannelMember(post.ChannelId, userID); appErr != nil {
			continue
		}
		doc, err := p.getReadReceiptDoc(postID)
		if err != nil {
			p.API.LogError("getReadReceiptDoc failed", "post_id", postID, "error", err.Error())
			continue
		}
		filtered := make(map[string]int64)
		for rid, ts := range doc.Readers {
			if rid == post.UserId {
				continue
			}
			filtered[rid] = ts
		}
		if len(filtered) > 0 {
			out[postID] = filtered
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"receipts": out})
}
