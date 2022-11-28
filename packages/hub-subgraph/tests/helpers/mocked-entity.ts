import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { Permission, Project, ProjectPurchase, TimeBasedSubscription } from "../../generated/schema"

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
    project.purchases = []
    project.purchasesCount = 0
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

export function createProjectPurchaseEntity(
    projectId: string,
    projectPurchaseId: string,
    subscriber: string,
    subscriptionSeconds: number,
    price: number,
    fee: number,
    purchasedAt: number
): ProjectPurchase {
    const projectPurchase = new ProjectPurchase(projectPurchaseId)
    projectPurchase.id = projectPurchaseId
    projectPurchase.project = projectId
    projectPurchase.subscriber = Bytes.fromHexString(subscriber)
    projectPurchase.price = BigInt.fromI32(price as i32)
    projectPurchase.subscriptionSeconds = BigInt.fromI32(subscriptionSeconds as i32)
    projectPurchase.fee = BigInt.fromI32(fee as i32)
    projectPurchase.purchasedAt = BigInt.fromI32(purchasedAt as i32)
    projectPurchase.save()
    return projectPurchase
}
