import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { Permission, Project, TimeBasedSubscription } from "../../generated/schema"

export function createProjectEntity(projectId: string): Project {
    const project = new Project(projectId)
    project.id = projectId
    project.beneficiary = Address.fromString("0xd8da6bf26964af9d7eed9e03e53415d37aa96045") // vitalik.eth
    project.pricePerSecond = BigInt.fromI32(1)
    project.pricingTokenAddress = Address.fromString("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") // USDC
    project.minimumSubscriptionSeconds = BigInt.fromI32(1)
    project.metadata = "metadata-" + projectId
    project.version = BigInt.fromI32(1)
    project.subscriptions = []
    project.streams = []
    project.permissions = []
    project.save()
    return project
}

export function createPermissionEntity(
    projectId: string,
    permissionId: string,
    userAddress: string,
    canBuy: boolean, canDelete: boolean, canEdit: boolean, canGrant: boolean
): Permission {
    const permission = new Permission(permissionId)
    permission.id = permissionId
    permission.userAddress = Bytes.fromHexString(userAddress)
    permission.project = projectId
    permission.canBuy = canBuy
    permission.canDelete = canDelete
    permission.canEdit = canEdit
    permission.canGrant = canGrant
    permission.save()
    return permission
}

export function createSubscriptionEntity(
    projectId: string,
    subscriptionId: string,
    userAddress: string,
    endTimestamp: number
): TimeBasedSubscription {
    const subscription = new TimeBasedSubscription(subscriptionId)
    subscription.id = subscriptionId
    subscription.project = projectId
    subscription.userAddress = Bytes.fromHexString(userAddress)
    subscription.endTimestamp = BigInt.fromI32(endTimestamp as i32)
    subscription.save()
    return subscription
}
