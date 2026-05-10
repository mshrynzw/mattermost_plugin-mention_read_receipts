package main

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
)

var broadcastMentionRE = regexp.MustCompile(`(?i)@(channel|all|here)\b`)

var atUsernameRE = regexp.MustCompile(`@([a-z0-9._-]+)`)

// readerMayAckReadReceipt reports whether readerID may record a read receipt for post
// (explicit user/group mentions in props, @username in message, or @channel/@all/@here).
func (p *Plugin) readerMayAckReadReceipt(readerID string, post *model.Post) bool {
	if post == nil || readerID == "" {
		return false
	}

	msg := post.Message
	if broadcastMentionRE.MatchString(msg) {
		return true
	}

	for _, id := range mentionUserIDsFromProps(post) {
		if id == readerID {
			return true
		}
	}

	for _, name := range atUsernamesInMessage(msg) {
		lower := strings.ToLower(name)
		if lower == "channel" || lower == "all" || lower == "here" {
			continue
		}
		user, appErr := p.API.GetUserByUsername(name)
		if appErr != nil {
			continue
		}
		if user.Id == readerID {
			return true
		}
	}

	return false
}

func mentionUserIDsFromProps(post *model.Post) []string {
	if post.Props == nil {
		return nil
	}
	raw, ok := post.Props["mentions"]
	if !ok || raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case []string:
		return append([]string(nil), v...)
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		var ids []string
		if err := json.Unmarshal([]byte(v), &ids); err != nil {
			return nil
		}
		return ids
	default:
		return nil
	}
}

func atUsernamesInMessage(message string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, m := range atUsernameRE.FindAllStringSubmatch(message, -1) {
		if len(m) < 2 {
			continue
		}
		name := m[1]
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}
