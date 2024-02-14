import type { StreamRegistry } from "@streamr/network-contracts"
import type { ContractReceipt, Event } from "@ethersproject/contracts"

export type FormattedReceipt = {
    blockNumber: number,
    from: string,
    to: string,
    transactionHash: string,
    events?: FormattedEvent[],
}
export function formatReceipt(receipt: ContractReceipt): FormattedReceipt {
    return {
        blockNumber: receipt.blockNumber,
        from: receipt.from,
        to: receipt.to,
        transactionHash: receipt.transactionHash,
        events: receipt.events?.map(formatEvent),
    }
}

export type FormattedEvent = {
    event: string,
    args: Record<string, string>,
    address?: string,
}
export function formatEvent(e: Event): FormattedEvent {
    return e.event ? {
        event: e.event,
        args: !e.args ? {} : Object.fromEntries(
            Object.keys(e.args).filter((k) => isNaN(parseInt(k))).map((k) => [k, e.args![k].toString() as string])
        ),
    } : {
        event: "unknown",
        args: {},
        address: e.address,
    }
}

export function formatPermissions(permissions: StreamRegistry.PermissionStructOutput): string[] {
    const now = Math.floor(Date.now() / 1000)
    return [
        permissions.canGrant ? "grant" : "",
        permissions.canEdit ? "edit" : "",
        permissions.canDelete ? "delete" : "",
        permissions.publishExpiration.gt(now) ? "publish" : "",
        permissions.subscribeExpiration.gt(now) ? "subscribe" : "",
    ].filter((x) => x)
}
