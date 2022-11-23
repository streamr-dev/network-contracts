import { Address, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { newMockEvent } from "matchstick-as"
import { ProjectPurchased } from "../../generated/MarketplaceV4/MarketplaceV4"
import {
    PermissionUpdated,
    ProjectCreated,
    ProjectDeleted,
    ProjectUpdated,
    StreamAdded,
    StreamRemoved,
    Subscribed,
} from "../../generated/ProjectRegistry/ProjectRegistry"

export function createProjectCreatedEvent(
    id: Bytes,
    beneficiary: string,
    pricePerSecond: number,
    pricingTokenAddress: string,
    minimumSubscriptionSeconds: number,
    metadata: string
): ProjectCreated {
    const projectCreatedEvent = changetype<ProjectCreated>(newMockEvent())
    projectCreatedEvent.parameters = new Array()

    const idParam = new ethereum.EventParam("id", ethereum.Value.fromBytes(id))
    projectCreatedEvent.parameters.push(idParam)
    const beneficiaryParam = new ethereum.EventParam("beneficiary", ethereum.Value.fromAddress(Address.fromString(beneficiary)))
    projectCreatedEvent.parameters.push(beneficiaryParam)
    const pricePerSecondParam = new ethereum.EventParam("pricePerSecond", ethereum.Value.fromI32(pricePerSecond as i32))
    projectCreatedEvent.parameters.push(pricePerSecondParam)
    const pricingTokenAddrParam = new ethereum.EventParam("pricingTokenAddress", ethereum.Value.fromAddress(Address.fromString(pricingTokenAddress)))
    projectCreatedEvent.parameters.push(pricingTokenAddrParam)
    const minSubSecondsParam = new ethereum.EventParam("minimumSubscriptionSeconds", ethereum.Value.fromI32(minimumSubscriptionSeconds as i32))
    projectCreatedEvent.parameters.push(minSubSecondsParam)
    const metadataParam = new ethereum.EventParam("metadata", ethereum.Value.fromString(metadata))
    projectCreatedEvent.parameters.push(metadataParam)
    
    return projectCreatedEvent
}

export function createProjectUpdatedEvent(
    id: Bytes,
    beneficiary: string,
    pricePerSecond: number,
    pricingTokenAddress: string,
    minimumSubscriptionSeconds: number,
    metadata: string
): ProjectUpdated {
    const projectUpdatedEvent = changetype<ProjectUpdated>(newMockEvent())
    projectUpdatedEvent.parameters = new Array()

    const idParam = new ethereum.EventParam("id", ethereum.Value.fromBytes(id))
    projectUpdatedEvent.parameters.push(idParam)
    const beneficiaryParam = new ethereum.EventParam("beneficiary", ethereum.Value.fromAddress(Address.fromString(beneficiary)))
    projectUpdatedEvent.parameters.push(beneficiaryParam)
    const pricePerSecondParam = new ethereum.EventParam("pricePerSecond", ethereum.Value.fromI32(pricePerSecond as i32))
    projectUpdatedEvent.parameters.push(pricePerSecondParam)
    const pricingTokenAddrParam = new ethereum.EventParam("pricingTokenAddress", ethereum.Value.fromAddress(Address.fromString(pricingTokenAddress)))
    projectUpdatedEvent.parameters.push(pricingTokenAddrParam)
    const minSubSecondsParam = new ethereum.EventParam("minimumSubscriptionSeconds", ethereum.Value.fromI32(minimumSubscriptionSeconds as i32))
    projectUpdatedEvent.parameters.push(minSubSecondsParam)
    const metadataParam = new ethereum.EventParam("metadata", ethereum.Value.fromString(metadata))
    projectUpdatedEvent.parameters.push(metadataParam)
    
    return projectUpdatedEvent
}

export function createStreamAddedEvent(projectId: Bytes, streamId: string): StreamAdded {
    const streamAddedEvent = changetype<StreamAdded>(newMockEvent())
    streamAddedEvent.parameters = new Array()
    const projectIdParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    streamAddedEvent.parameters.push(projectIdParam)
    const streamIdParam = new ethereum.EventParam("streamId", ethereum.Value.fromString(streamId))
    streamAddedEvent.parameters.push(streamIdParam)
    return streamAddedEvent
}

export function createStreamedRemovedEvent(projectId: Bytes, streamId: string): StreamRemoved {
    const streamRemovedEvent = changetype<StreamRemoved>(newMockEvent())
    streamRemovedEvent.parameters = new Array()
    const projectIdPAram = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    streamRemovedEvent.parameters.push(projectIdPAram)
    const streamIdParam = new ethereum.EventParam("streamId", ethereum.Value.fromString(streamId))
    streamRemovedEvent.parameters.push(streamIdParam)
    return streamRemovedEvent
}

export function createPermissionUpdatedEvent(
    user: string,
    projectId: Bytes,
    canBuy: boolean,
    canDelete: boolean,
    canEdit: boolean,
    canGrant: boolean
): PermissionUpdated {
    const permissionUpdatedEvent = changetype<PermissionUpdated>(newMockEvent())
    permissionUpdatedEvent.parameters = new Array()

    const projectParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    permissionUpdatedEvent.parameters.push(projectParam)
    const userParam = new ethereum.EventParam("user", ethereum.Value.fromAddress(Address.fromString(user)))
    permissionUpdatedEvent.parameters.push(userParam)
    const canBuyParam = new ethereum.EventParam("canBuy", ethereum.Value.fromBoolean(canBuy))
    permissionUpdatedEvent.parameters.push(canBuyParam)
    const canDeleteParam = new ethereum.EventParam("canDelete", ethereum.Value.fromBoolean(canDelete))
    permissionUpdatedEvent.parameters.push(canDeleteParam)
    const canEditParam = new ethereum.EventParam("canEdit", ethereum.Value.fromBoolean(canEdit))
    permissionUpdatedEvent.parameters.push(canEditParam)
    const canGrantParam = new ethereum.EventParam("canGrant", ethereum.Value.fromBoolean(canGrant))
    permissionUpdatedEvent.parameters.push(canGrantParam)
    
    return permissionUpdatedEvent
}

export function createSubscribedEvent(projectId: Bytes, subscriber: string, endTimestamp: number): Subscribed {
    const subscribedEvent = changetype<Subscribed>(newMockEvent())
    subscribedEvent.parameters = new Array()

    const projectIdParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    subscribedEvent.parameters.push(projectIdParam)
    const subscriberParam = new ethereum.EventParam("subscriber", ethereum.Value.fromAddress(Address.fromString(subscriber)))
    subscribedEvent.parameters.push(subscriberParam)
    const endTimestampParam = new ethereum.EventParam("endTimestamp", ethereum.Value.fromI32(endTimestamp as i32))
    subscribedEvent.parameters.push(endTimestampParam)

    return subscribedEvent
}

export function createProjectDeletedEvent(
    id: Bytes,
): ProjectDeleted {
    const projectDeletedEvent = changetype<ProjectDeleted>(newMockEvent())
    projectDeletedEvent.parameters = new Array()

    const idParam = new ethereum.EventParam("id", ethereum.Value.fromBytes(id))
    projectDeletedEvent.parameters.push(idParam)
    
    return projectDeletedEvent
}
export function createProjectPurchasedEvent(
    projectId: Bytes,
    subscriber: string,
    subscriptionSeconds: number,
    price: number, fee: number,
): ProjectPurchased {
    const projectPurchasedEvent = changetype<ProjectPurchased>(newMockEvent())
    projectPurchasedEvent.parameters = new Array()

    const projectIdParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    projectPurchasedEvent.parameters.push(projectIdParam)
    const subscriberParam = new ethereum.EventParam("subscriber", ethereum.Value.fromAddress(Address.fromString(subscriber)))
    projectPurchasedEvent.parameters.push(subscriberParam)
    const subscriptionSecondsParam = new ethereum.EventParam("subscriptionSeconds", ethereum.Value.fromI32(subscriptionSeconds as i32))
    projectPurchasedEvent.parameters.push(subscriptionSecondsParam)
    const priceParam = new ethereum.EventParam("price", ethereum.Value.fromI32(price as i32))
    projectPurchasedEvent.parameters.push(priceParam)
    const feeParam = new ethereum.EventParam("fee", ethereum.Value.fromI32(fee as i32))
    projectPurchasedEvent.parameters.push(feeParam)

    return projectPurchasedEvent
}
