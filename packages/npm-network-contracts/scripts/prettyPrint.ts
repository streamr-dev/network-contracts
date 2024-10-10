import type { StreamRegistry } from "../src/exports"
import { ContractTransactionReceipt, EventLog } from "ethers"

export type FormattedReceipt = {
    blockNumber: number,
    from: string,
    to: string,
    transactionHash: string,
    events?: FormattedEvent[],
}
export function formatReceipt(receipt: ContractTransactionReceipt | null): FormattedReceipt {
    return {
        blockNumber: receipt?.blockNumber ?? 0,
        from: receipt?.from ?? "",
        to: receipt?.to ?? "",
        transactionHash: receipt?.hash ?? "",
        events: receipt?.logs?.filter((x) => x instanceof EventLog).map(formatEvent) ?? [],
    }
}

export type FormattedEvent = {
    event: string,
    args: Record<string, string>,
    address?: string,
}
export function formatEvent(e: EventLog): FormattedEvent {
    return e.eventName ? {
        event: e.eventName,
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
        permissions.publishExpiration > now ? "publish" : "",
        permissions.subscribeExpiration > now ? "subscribe" : "",
    ].filter((x) => x)
}
