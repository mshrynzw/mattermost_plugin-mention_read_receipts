// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {useSelector, useStore} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';
import type {Post} from '@mattermost/types/posts';
import {getPost} from 'mattermost-redux/selectors/entities/posts';
import {getCurrentUserId, getUser} from 'mattermost-redux/selectors/entities/users';

import {scheduleReceiptFetch} from './read_receipt_fetch_batch';
import {enqueueMarkPostRead} from './read_receipt_mark_batch';
import {isCurrentUserMentionReadReceiptTarget} from './read_receipt_mentions';
import * as ReceiptStore from './read_receipt_store';

import './read_receipt.css';

/** Mattermost passes postId (not post) for PostMessageAttachment pluggables. */
export type Props = {
    postId?: string;
    post?: Post;
    onHeightChange?: (height: number) => void;
};

function usePostReceipts(postId: string): Record<string, number> {
    return useSyncExternalStore(
        ReceiptStore.subscribeReceipts,
        () => ReceiptStore.getReceiptsSnapshot(postId),
        () => ({}),
    );
}

export default function PostReadReceipt(props: Props): React.ReactElement | null {
    const postId = props.post?.id ?? props.postId ?? '';
    const store = useStore<GlobalState>();
    const postFromStore = useSelector((state: GlobalState) => (postId ? getPost(state, postId) : undefined));
    const post = props.post ?? postFromStore;
    const currentUserId = useSelector(getCurrentUserId);
    const rootRef = useRef<HTMLDivElement>(null);

    const isDeleted = Boolean(post && post.delete_at > 0);
    const isOwnPost = Boolean(post && currentUserId && post.user_id === currentUserId);

    const receipts = usePostReceipts(postId);

    const sortedReaderIds = useMemo(() => {
        if (!post) {
            return [];
        }
        return Object.entries(receipts).
            filter(([uid]) => uid !== post.user_id).
            sort((a, b) => a[1] - b[1]).
            map(([uid]) => uid);
    }, [receipts, post]);

    const readerLabels = useSelector((state: GlobalState) => {
        const labels: Record<string, string> = {};
        for (const uid of sortedReaderIds) {
            const u = getUser(state, uid);
            labels[uid] = u?.username ?? uid.slice(0, 8);
        }
        return labels;
    });

    const sortedReadersKey = sortedReaderIds.join(',');

    useLayoutEffect(() => {
        props.onHeightChange?.(rootRef.current?.offsetHeight ?? 0);
    }, [props.onHeightChange, sortedReadersKey, post?.id, isOwnPost]);

    useEffect(() => {
        if (!postId || isDeleted || !isOwnPost) {
            return undefined;
        }
        scheduleReceiptFetch(postId);
        const interval = window.setInterval(() => scheduleReceiptFetch(postId), 12000);
        return () => window.clearInterval(interval);
    }, [postId, isDeleted, isOwnPost]);

    useEffect(() => {
        if (!postId || isDeleted || isOwnPost || !currentUserId) {
            return undefined;
        }
        const uid = `${currentUserId}`;
        const pid = postId;
        const el = rootRef.current;
        if (!el) {
            return undefined;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting && entry.intersectionRatio >= 0.2) {
                        const state = store.getState();
                        const latest: Post | undefined = getPost(state, pid);
                        if (latest && isCurrentUserMentionReadReceiptTarget(state, latest, uid)) {
                            enqueueMarkPostRead(pid);
                        }
                        break;
                    }
                }
            },
            {threshold: [0, 0.2, 0.5]},
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [postId, isDeleted, isOwnPost, currentUserId, store, post]);

    if (!postId || isDeleted) {
        return null;
    }

    if (!isOwnPost) {
        return (
            <div
                ref={rootRef}
                className='post-read-receipt-anchor'
                style={{minHeight: '1px'}}
            />
        );
    }

    if (sortedReaderIds.length === 0) {
        return (
            <div
                ref={rootRef}
                className='post-read-receipt-anchor'
                style={{minHeight: '1px'}}
            />
        );
    }

    const names = sortedReaderIds.map((id) => readerLabels[id]).join(', ');

    return (
        <div
            ref={rootRef}
            className='post-read-receipt-summary'
            style={{
                fontSize: '12px',
                lineHeight: '16px',
                opacity: 0.72,
                marginTop: '4px',
            }}
        >
            {'Read: '}
            <span title={names}>{names}</span>
        </div>
    );
}
