import { ByteArray, Bytes, log, store, crypto } from '@graphprotocol/graph-ts'

import { StreamCreated, StreamDeleted, StreamUpdated, PermissionUpdated, PermissionUpdatedForUserId }
    from '../generated/StreamRegistry/StreamRegistry'
import { Stream, StreamPermission } from '../generated/schema'
import { MAX_STREAM_ID_LENGTH } from './helpers'

function getPermissionId(streamId: string, userId: Bytes): string {
    // Uses the hash of userId instead of the full ID, since userId can be very long (potentially several kilobytes).
    // It's unclear whether there is a strict character limit for ID fields, but in practice, multi-kilobyte IDs can
    // cause indexing issues (see ETH-867).
    return streamId + "-" + crypto.keccak256(userId).toHexString()
}

export function handleStreamCreation(event: StreamCreated): void {
    log.info('handleStreamCreation: id={} metadata={} blockNumber={}',
        [event.params.id, event.params.metadata, event.block.number.toString()])
    if (event.params.id.length > MAX_STREAM_ID_LENGTH) {
        log.warning("Overlong stream id not supported: {}", [event.params.id]) 
        return
    }
    let stream = new Stream(event.params.id)
    stream.idAsString = event.params.id
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
    if (event.params.streamId.length > MAX_STREAM_ID_LENGTH) {
        log.warning("Overlong stream id not supported: {}", [event.params.streamId]) 
        return
    }
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
    if (event.params.streamId.length > MAX_STREAM_ID_LENGTH) {
        log.warning("Overlong stream id not supported: {}", [event.params.streamId]) 
        return
    }
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
