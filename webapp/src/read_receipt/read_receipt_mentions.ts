// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {GlobalState} from '@mattermost/types/store';
import type {Post} from '@mattermost/types/posts';
import {getUsersByUsername} from 'mattermost-redux/selectors/entities/users';

const broadcastMentionRE = /@(channel|all|here)\b/gi;

const atUsernameRE = /@([a-z0-9._-]+)/gi;

const broadcastKeywords = new Set(['channel', 'all', 'here']);

export function postHasBroadcastMention(message: string): boolean {
    broadcastMentionRE.lastIndex = 0;
    return broadcastMentionRE.test(message);
}

export function getExplicitMentionUserIdsFromPost(post: Post): string[] {
    const raw = post.props?.mentions;
    if (raw == null) {
        return [];
    }
    if (Array.isArray(raw)) {
        return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
    }
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
                return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
            }
        } catch {
            return [];
        }
    }
    return [];
}

/**
 * Matches server-side readerMayAckReadReceipt for normal channel posts.
 */
export function isCurrentUserMentionReadReceiptTarget(state: GlobalState, post: Post, currentUserId: string): boolean {
    if (!currentUserId || post.user_id === currentUserId) {
        return false;
    }
    const msg = post.message ?? '';
    if (postHasBroadcastMention(msg)) {
        return true;
    }
    const fromProps = getExplicitMentionUserIdsFromPost(post);
    if (fromProps.some((id) => id === currentUserId)) {
        return true;
    }
    const byUsername = getUsersByUsername(state);
    let match: RegExpExecArray | null;
    const re = new RegExp(atUsernameRE.source, atUsernameRE.flags);
    while ((match = re.exec(msg)) !== null) {
        const name = match[1];
        if (!name) {
            continue;
        }
        if (broadcastKeywords.has(name.toLowerCase())) {
            continue;
        }
        const key = name.toLowerCase();
        const u = byUsername[key] ?? byUsername[name];
        if (u && u.id === currentUserId) {
            return true;
        }
    }
    return false;
}
