// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const receiptsByPost = new Map<string, Record<string, number>>();
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((fn) => {
        fn();
    });
}

export function subscribeReceipts(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getReceiptsSnapshot(postId: string): Record<string, number> {
    return receiptsByPost.get(postId) ?? {};
}

export function mergeReceipts(postId: string, readers: Record<string, number>): void {
    const prev = receiptsByPost.get(postId) ?? {};
    receiptsByPost.set(postId, {...prev, ...readers});
    notify();
}

export function applyReceiptEvent(postId: string, readerId: string, readAt: number): void {
    const prev = receiptsByPost.get(postId) ?? {};
    const existing = prev[readerId] ?? 0;
    if (readAt <= existing) {
        return;
    }
    receiptsByPost.set(postId, {...prev, [readerId]: readAt});
    notify();
}
