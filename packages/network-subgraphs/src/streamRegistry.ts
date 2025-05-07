import { ByteArray, Bytes, log, store, crypto } from '@graphprotocol/graph-ts'

import { StreamCreated, StreamDeleted, StreamUpdated, PermissionUpdated, PermissionUpdatedForUserId }
    from '../generated/StreamRegistry/StreamRegistry'
import { Stream, StreamPermission } from '../generated/schema'

/**
 * Hash the streamId and the userId, in order to get constant-length permission IDs (ETH-867)
 * This avoids indexing problems if the userId is very long (many kilobytes).
 **/
function getPermissionId(streamId: string, userId: Bytes): string {
    return crypto.keccak256(Bytes.fromUTF8(streamId).concat(userId)).toHexString()
}

export function handleStreamCreation(event: StreamCreated): void {
    log.info('handleStreamCreation: id={} metadata={} blockNumber={}',
        [event.params.id, event.params.metadata, event.block.number.toString()])
    let stream = new Stream(event.params.id)
    stream.metadata = event.params.metadata
    stream.createdAt = event.block.timestamp
    stream.updatedAt = event.block.timestamp
    stream.save()
}

export function handleStreamDeletion(event: StreamDeleted): void {
    log.info('handleDeleteStream: id={} blockNumber={}',
        [event.params.id, event.block.number.toString()])
    store.remove('Stream', event.params.id)
}

export function handleStreamUpdate(event: StreamUpdated): void {
    log.info('handleUpdateStream: id={} metadata={} blockNumber={}',
        [event.params.id, event.params.metadata, event.block.number.toString()])
    let stream = Stream.load(event.params.id)
    if (stream === null) {
        stream = new Stream(event.params.id)
        stream.createdAt = event.block.timestamp
    }
    stream.metadata = event.params.metadata
    stream.updatedAt = event.block.timestamp
    stream.save()
}

export function handlePermissionUpdate(event: PermissionUpdated): void {
    log.info('handlePermissionUpdate: user={} streamId={} blockNumber={}',
        [event.params.user.toHexString(), event.params.streamId, event.block.number.toString()])
    let stream = Stream.load(event.params.streamId)
    if (stream == null) { return }

    let permissionId = getPermissionId(event.params.streamId, event.params.user)
    let permission = new StreamPermission(permissionId)
    permission.userAddress = event.params.user
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

export function handlePermissionUpdateForUserId(event: PermissionUpdatedForUserId): void {
    log.info('handlePermissionUpdateForUserId: user={} streamId={} blockNumber={}',
        [event.params.user.toHexString(), event.params.streamId, event.block.number.toString()])
    let stream = Stream.load(event.params.streamId)
    if (stream == null) { return }

    let permissionId = getPermissionId(event.params.streamId, event.params.user)
    let permission = new StreamPermission(permissionId)
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
