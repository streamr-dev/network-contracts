import { log, store } from '@graphprotocol/graph-ts'
import { Permission, Project, TimeBasedSubscription } from '../generated/schema'
import {
    ProjectCreated,
    ProjectDeleted,
    ProjectUpdated,
    PermissionUpdated,
    Subscribed,
    StreamAdded,
    StreamRemoved,
} from '../generated/ProjectRegistry/ProjectRegistry'

export function handleProjectCreation(event: ProjectCreated): void {
    const id = event.params.id.toHexString()
    const metadata = event.params.metadata
    log.info('handleProjectCreated: id={} metadata={} blockNumber={}',
        [id, metadata, event.block.number.toString()])
    let project = new Project(id)
    project.id = id
    project.beneficiary = event.params.beneficiary
    project.pricePerSecond = event.params.pricePerSecond
    project.pricingTokenAddress = event.params.pricingTokenAddress
    project.minimumSubscriptionSeconds = event.params.minimumSubscriptionSeconds
    project.metadata = metadata
    project.streams = new Array<string>()
    project.createdAt = event.block.timestamp
    project.purchasesCount = 0
    project.save()
}

export function handleProjectDeletion(event: ProjectDeleted): void {
    const id = event.params.id.toHexString()
    log.info('handleProjectDeletion: id={} blockNumber={}',
        [id, event.block.number.toString()])
    store.remove('Project', id)
}

export function handleProjectUpdate(event: ProjectUpdated): void {
    let id = event.params.id.toHexString()
    log.info('handleProjectUpdated: id={} metadata={} blockNumber={}',
        [id, event.params.metadata, event.block.number.toString()])

    let project = Project.load(id)
    if (project == null) { project = new Project(id) }

    project.beneficiary = event.params.beneficiary
    project.pricePerSecond = event.params.pricePerSecond
    project.pricingTokenAddress = event.params.pricingTokenAddress
    project.minimumSubscriptionSeconds = event.params.minimumSubscriptionSeconds
    project.metadata = event.params.metadata
    project.updatedAt = event.block.timestamp
    project.save()
}

export function handlePermissionUpdate(event: PermissionUpdated): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    log.info('handlePermissionUpdate: user={} projectId={} blockNumber={}',
        [user, projectId, event.block.number.toString()])

    let project = Project.load(projectId)
    if (project != null) {
        let permissionId = projectId + '-' + user
        let permission = new Permission(permissionId)
        permission.userAddress = event.params.user
        permission.project = projectId
        permission.canBuy = event.params.canBuy
        permission.canDelete = event.params.canDelete
        permission.canEdit = event.params.canEdit
        permission.canGrant = event.params.canGrant
        permission.save()
        project.save()
    }
}

export function handleSubscriptionUpdate(event: Subscribed): void {
    const projectId = event.params.projectId.toHexString()
    const subscriber = event.params.subscriber.toHexString()
    log.info('handleSubscriptionUpdate: projectId={} subscriber={} blockNumber={}',
        [projectId, subscriber, event.block.number.toString()])

    let project = Project.load(projectId)
    if (project != null) {
        let subscriptionId = projectId + '-' + subscriber
        let subscription = new TimeBasedSubscription(subscriptionId)
        subscription.project = projectId
        subscription.userAddress = event.params.subscriber
        subscription.endTimestamp = event.params.endTimestamp
        subscription.save()
        project.save()
    }
}

export function handleStreamAdition(event: StreamAdded): void {
    let projectId = event.params.projectId.toHexString()
    const streamId = event.params.streamId
    log.info('handleStreamAdition: projectId={} streamId={} blockNumber={}',
        [projectId, streamId, event.block.number.toString()])

    let project = Project.load(projectId)
    if (project != null) {
        const streams = project.streams
        streams.push(streamId)
        project.streams = streams
        project.save()
    }
}

export function handleStreamRemoval(event: StreamRemoved): void {
    let projectId = event.params.projectId.toHexString()
    const streamId = event.params.streamId
    log.info('handleStreamRemoval: projectId={} streamId={} blockNumber={}',
        [projectId, streamId, event.block.number.toString()])

    let project = Project.load(projectId)
    if (project != null) {
        let streams = project.streams
        const streamIndex  = streams.indexOf(streamId)
        if (streamIndex != -1) {
            streams.splice(streamIndex, 1)
        }
        project.streams = streams
        project.save()
    }
}
