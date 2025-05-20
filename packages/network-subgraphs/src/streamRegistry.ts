import { ByteArray, Bytes, log, store, crypto } from '@graphprotocol/graph-ts'

import { StreamCreated, StreamDeleted, StreamUpdated, PermissionUpdated, PermissionUpdatedForUserId }
    from '../generated/StreamRegistry/StreamRegistry'
import { Stream, StreamPermission } from '../generated/schema'

/**
 * Hash the streamId and the userId, in order to get constant-length permission IDs (ETH-867)
 * This avoids indexing problems if the userId or streamId is very long (many kilobytes).
 *
 * TODO: after ETH-876 is solved, streamId can't be over-long, remove the slice(0, 1000) below
 *       because it could cause some streams with same 1k-prefix to mix up when sorting
 **/
function getPermissionId(streamEntityId: string, userId: Bytes): string {
    return streamEntityId + "-" + crypto.keccak256(Bytes.fromUTF8(streamEntityId).concat(userId)).toHexString()
}

/**
 * Build the subgraph entity ID; if streamId is short enough, use it as-is (for backwards compatibility)
 * @param streamId Stream ID in the StreamRegistry contract
 * @returns
 */
export function getStreamEntityId(streamId: string): string {
    return streamId.length <= 1000 ? streamId : streamId.slice(0, 1000) + "-" + crypto.keccak256(Bytes.fromUTF8(streamId)).toHexString()
}

export function handleStreamCreation(event: StreamCreated): void {
    log.info('handleStreamCreation: id={} metadata={} blockNumber={}',
        [event.params.id, event.params.metadata, event.block.number.toString()])
    const streamId = event.params.id
    const streamEntityId = getStreamEntityId(streamId)
    const stream = new Stream(streamEntityId)
    stream.streamId = streamId
    stream.metadata = event.params.metadata
    stream.createdAt = event.block.timestamp
    stream.updatedAt = event.block.timestamp
    stream.save()
}

export function handleStreamDeletion(event: StreamDeleted): void {
    log.info('handleDeleteStream: id={} blockNumber={}',
        [event.params.id, event.block.number.toString()])
    const streamEntityId = getStreamEntityId(event.params.id)
    store.remove('Stream', streamEntityId)
}

export function handleStreamUpdate(event: StreamUpdated): void {
    log.info('handleUpdateStream: id={} metadata={} blockNumber={}',
        [event.params.id, event.params.metadata, event.block.number.toString()])
    const streamId = event.params.id
    const streamEntityId = getStreamEntityId(streamId)
    let stream = Stream.load(streamEntityId)
    if (stream === null) {
        stream = new Stream(streamEntityId)
        stream.streamId = streamId
        stream.createdAt = event.block.timestamp
    }
    stream.metadata = event.params.metadata
    stream.updatedAt = event.block.timestamp
    stream.save()
}

export function handlePermissionUpdate(event: PermissionUpdated): void {
    log.info('handlePermissionUpdate: user={} streamId={} blockNumber={}',
        [event.params.user.toHexString(), event.params.streamId, event.block.number.toString()])
    const streamEntityId = getStreamEntityId(event.params.streamId)
    const stream = Stream.load(streamEntityId)
    if (stream == null) { return }

    const permissionId = getPermissionId(streamEntityId, event.params.user)
    const permission = new StreamPermission(permissionId)
    permission.userAddress = event.params.user
    permission.userId = event.params.user
    permission.stream = streamEntityId
    permission.canEdit = event.params.canEdit
    permission.canDelete = event.params.canDelete
    permission.publishExpiration = event.params.publishExpiration
    permission.subscribeExpiration = event.params.subscribeExpiration
    permission.canGrant = event.params.canGrant
    permission.save()

    stream.updatedAt = event.block.timestamp
    stream.save()
}

export function handlePermissionUpdateForUserId(event: PermissionUpdatedForUserId): void {
    log.info('handlePermissionUpdateForUserId: user={} streamId={} blockNumber={}',
        [event.params.user.toHexString(), event.params.streamId, event.block.number.toString()])
    const streamEntityId = getStreamEntityId(event.params.streamId)
    const stream = Stream.load(streamEntityId)
    if (stream == null) { return }

    const permissionId = getPermissionId(streamEntityId, event.params.user)
    const permission = new StreamPermission(permissionId)
    // Backwards compatibility: pad/concatenate to 20 bytes, Ethereum addresses remain Ethereum addresses.
    // This makes it possible to use both *forUserId functions and the old functions for Ethereum addresses.
    // All new code should use userId instead of userAddress, though; userAddress is marked as deprecated
    permission.userAddress = Bytes.fromUint8Array(ByteArray
        .fromHexString("0x0000000000000000000000000000000000000000")
        .concat(event.params.user)
        .slice(-20)
    )
    permission.userId = event.params.user
    permission.stream = event.params.streamId
    permission.canEdit = event.params.canEdit
    permission.canDelete = event.params.canDelete
    permission.publishExpiration = event.params.publishExpiration
    permission.subscribeExpiration = event.params.subscribeExpiration
    permission.canGrant = event.params.canGrant
    permission.save()

    stream.updatedAt = event.block.timestamp
    stream.save()
}
