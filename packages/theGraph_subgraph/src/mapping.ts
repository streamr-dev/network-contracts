import { BigInt, Bytes, log } from '@graphprotocol/graph-ts'

import { StreamCreated, TransferedPublishRights, TransferedViewRights }
    from '../generated/StreamRegistry/StreamRegistry'
import { Stream, Permission } from '../generated/schema'

type i32 = {}

function createPermission(id: string, user: Bytes, stream: string, isAdmin: boolean,
    viewRights: i32, publishRights: i32, expirationTime: BigInt): Permission {
    const permission = new Permission(id)
    permission.user = user
    permission.isadmin = isAdmin
    permission.stream = stream
    permission.expirationTime = expirationTime
    permission.viewRights = viewRights
    permission.publishRights = publishRights
    return permission
}

export function handleStreamCreation(event: StreamCreated): void {
    const stream = new Stream(event.params.id.toHex())
    stream.metadata = event.params.metadata
    stream.save()
    const permissionId = event.params.id.toHex() + '-' + event.params.owner.toHex()
    const permission = createPermission(permissionId,
        event.params.owner, event.params.id.toHex(), true, 1, 1, new BigInt(0))
    // let permission = new Permission()
    // permission.expirationTime = new BigInt(0)
    // permission.isadmin = true
    // permission.user = event.params.owner
    // permission.stream = event.params.id.toHex()
    permission.save()
}

export function handleTransferViewRights(event: TransferedViewRights): void {
    log.warning('handleTransferViewRights: id={} to={} blockNumber={}',
        [event.params.streamid.toHexString(), event.params.to.toHex(), event.block.number.toString()])

    const permissionSenderId = event.params.streamid.toHex() + '-' + event.params.from.toHex()
    const permissionRecipientId = event.params.streamid.toHex() + '-' + event.params.to.toHex()
    const permissionSender = Permission.load(permissionSenderId)
    let permissionRecipient = Permission.load(permissionRecipientId)
    if (permissionRecipient == null) {
        permissionRecipient = createPermission(permissionRecipientId, event.params.to,
            event.params.streamid.toHex(), false, 0, 0, new BigInt(0))
    }
    permissionSender.viewRights -= event.params.amount
    permissionRecipient.viewRights += event.params.amount
    permissionSender.save()
    permissionRecipient.save()
}

export function handleTransferPublishRights(event: TransferedPublishRights): void {
    log.warning('handleTransferPublishRights: id={} to={} blockNumber={}',
        [event.params.streamid.toHexString(), event.params.to.toHex(), event.block.number.toString()])

    const permissionSenderId = event.params.streamid.toHex() + '-' + event.params.from.toHex()
    const permissionRecipientId = event.params.streamid.toHex() + '-' + event.params.to.toHex()
    const permissionSender = Permission.load(permissionSenderId)
    let permissionRecipient = Permission.load(permissionRecipientId)
    if (permissionRecipient == null) {
        permissionRecipient = createPermission(permissionRecipientId, event.params.to,
            event.params.streamid.toHex(), false, 0, 0, new BigInt(0))
    }
    permissionSender.publishRights -= event.params.amount
    permissionRecipient.publishRights += event.params.amount
    permissionSender.save()
    permissionRecipient.save()
}
