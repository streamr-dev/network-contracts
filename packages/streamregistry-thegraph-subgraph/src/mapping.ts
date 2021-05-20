import { log, store } from '@graphprotocol/graph-ts'

import { StreamCreated, StreamDeleted, StreamUpdated, PermissionUpdated }
    from '../generated/StreamRegistry/StreamRegistry'
import { Stream, Permission } from '../generated/schema'

export function handleStreamCreation(event: StreamCreated): void {
    const stream = new Stream(event.params.id)
    stream.metadata = event.params.metadata
    stream.save()
}
export function handleStreamDeletion(event: StreamDeleted): void {
    log.warning('handleDeleteStream: id={} blockNumber={}',
        [event.params.id, event.block.number.toString()])
    store.remove('Stream', event.params.id)
}
export function handleStreamUpdate(event: StreamUpdated): void {
    log.warning('handleUpdateStream: id={} metadata={} blockNumber={}',
        [event.params.id, event.params.metadata, event.block.number.toString()])
    const stream = Stream.load(event.params.id)
    stream.metadata = event.params.metadata
    stream.save()
}
export function handlePermissionUpdate(event: PermissionUpdated): void {
    const permissionId = event.params.streamId + '-' + event.params.user.toHex()
    const permission = new Permission(permissionId)
    permission.user = event.params.user
    permission.stream = event.params.streamId
    permission.edit = event.params.edit
    permission.canDelete = event.params.canDelete
    permission.publish = event.params.publish
    permission.subscribed = event.params.subscribed
    permission.share = event.params.share
    permission.save()
}
