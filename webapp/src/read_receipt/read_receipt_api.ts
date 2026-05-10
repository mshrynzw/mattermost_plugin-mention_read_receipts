// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from 'manifest';

function siteRoot(): string {
    const base = (window as unknown as {basename?: string}).basename;
    return base || '';
}

function baseHeaders(includeJSONContentType: boolean): Record<string, string> {
    const headers: Record<string, string> = {
        'X-Requested-With': 'XMLHttpRequest',
    };
    if (includeJSONContentType) {
        headers['Content-Type'] = 'application/json';
    }
    const match = document.cookie.match(/(?:^|; )MMCSRF=([^;]*)/);
    if (match) {
        headers['X-CSRF-Token'] = decodeURIComponent(match[1]);
    }
    return headers;
}

function pluginURL(path: string): string {
    return `${siteRoot()}/plugins/${manifest.id}${path}`;
}

export async function markPostsRead(postIds: string[]): Promise<void> {
    if (postIds.length === 0) {
        return;
    }
    const res = await fetch(pluginURL('/api/v1/read-receipts/mark'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: baseHeaders(true),
        body: JSON.stringify({post_ids: postIds}),
    });
    if (!res.ok) {
        throw new Error(`markPostsRead failed: ${res.status}`);
    }
}

export async function fetchPostReceipts(postIds: string[]): Promise<Record<string, Record<string, number>>> {
    if (postIds.length === 0) {
        return {};
    }
    const qs = new URLSearchParams({post_ids: postIds.join(',')});
    const res = await fetch(pluginURL(`/api/v1/read-receipts?${qs.toString()}`), {
        method: 'GET',
        credentials: 'same-origin',
        headers: baseHeaders(false),
    });
    if (!res.ok) {
        throw new Error(`fetchPostReceipts failed: ${res.status}`);
    }
    const data = (await res.json()) as { receipts?: Record<string, Record<string, number>> };
    return data.receipts ?? {};
}
