import { BigInt, Bytes, json, JSONValue, JSONValueKind, Result, store } from "@graphprotocol/graph-ts"
import { InternalBookeeping, Project } from '../generated/schema'
import { INTERNAL_BOOKEEPING_ID, PAYMENT_DETAILS_ENTITY_TYPE, PERMISSION_ENTITY_TYPE, SUBSCRIPTION_ENTITY_TYPE } from "./constants"

/**
 * Helper function to load a project or create a project with default values. It will probably silence some errors.
 * @dev toHexString() will automatically lowercase the projectId
 */
export function loadOrCreateProject(projectId: Bytes): Project {
    let project = Project.load(projectId.toHexString())
    if (project == null) {
        project = new Project(projectId.toHexString())
        project.domainIds = []
        project.minimumSubscriptionSeconds = BigInt.fromI32(0)
        project.metadata = ""
        project.streams = []
        project.createdAt = BigInt.fromI32(0)
        project.counter = 0
        project.score = BigInt.fromI32(0)
        project.isDataUnion = false
    }
    return project
}

/**
 * Helper function to load projects internal bookeeping. Contains arrays of ids of derived entities.'
 */
export function loadInternalBookeeping(): InternalBookeeping {
    let internalBookeeping = InternalBookeeping.load(INTERNAL_BOOKEEPING_ID)
    if (internalBookeeping == null) {
        internalBookeeping = new InternalBookeeping(INTERNAL_BOOKEEPING_ID)
        internalBookeeping.permissionIds = []
        internalBookeeping.subscriptionIds = []
        internalBookeeping.paymentDetailsIds = []
    }
    return internalBookeeping
}

/**
 * Helper function to update the internal bookeeping of the store. Contains arrays of ids of derived entities.
 */
export function updateInternalBookeeping(derivedEntity: string, id: string): InternalBookeeping {
    let internalBookeeping = loadInternalBookeeping()

    if (derivedEntity == PERMISSION_ENTITY_TYPE) {
        let permissionIds = internalBookeeping.permissionIds
        permissionIds.push(id)
        internalBookeeping.permissionIds = permissionIds
    }
    else if (derivedEntity == SUBSCRIPTION_ENTITY_TYPE) {
        let subscriptionIds = internalBookeeping.subscriptionIds
        subscriptionIds.push(id)
        internalBookeeping.subscriptionIds = subscriptionIds
    }
    else if (derivedEntity == PAYMENT_DETAILS_ENTITY_TYPE) {
        let paymentDetailsIds = internalBookeeping.paymentDetailsIds
        paymentDetailsIds.push(id)
        internalBookeeping.paymentDetailsIds = paymentDetailsIds
    }
    
    internalBookeeping.save()
    return internalBookeeping
}

/**
 * Helper function to remove derived project entities from the store, when the project is deleted
 */
export function storeRemoveCascadedEntities(projectId: string): void {
    let internalBookeeping = loadInternalBookeeping()
    
    // clear store of permissions related to deleted project
    let permissionIds = internalBookeeping.permissionIds
    let filteredPermissionIds: string[] = []
    for(let i = 0; i < permissionIds.length; i++) {
        let permissionId = permissionIds[i]
        if (permissionId.slice(0, 66) == projectId) {
            store.remove(PERMISSION_ENTITY_TYPE, permissionId)
        } else {
            filteredPermissionIds.push(permissionId)
        }
    }
    internalBookeeping.permissionIds = filteredPermissionIds

    // clear store of subscriptions related to deleted project
    let subscriptionIds = internalBookeeping.subscriptionIds
    let filteredSubscriptionIds: string[] = []
    for(let i = 0; i < subscriptionIds.length; i++) {
        let subscriptionId = subscriptionIds[i]
        if (subscriptionId.slice(0, 66) == projectId) {
            store.remove(SUBSCRIPTION_ENTITY_TYPE, subscriptionId)
        } else {
            filteredSubscriptionIds.push(subscriptionId)
        }
    }
    internalBookeeping.subscriptionIds = filteredSubscriptionIds

    // clear store of payment details related to deleted project
    let paymentDetailsIds = internalBookeeping.paymentDetailsIds
    let filteredPaymentDetailsIds: string[] = []
    for(let i = 0; i < paymentDetailsIds.length; i++) {
        let paymentDetailsId = paymentDetailsIds[i]
        if (paymentDetailsId.slice(0, 66) == projectId) {
            store.remove(PAYMENT_DETAILS_ENTITY_TYPE, paymentDetailsId)
        } else {
            filteredPaymentDetailsIds.push(paymentDetailsId)
        }
    }
    internalBookeeping.paymentDetailsIds = filteredPaymentDetailsIds

    internalBookeeping.save()
}

/**
 * Parse string to JSON and return the value of the "isDataUnion" key.
 * @dev https://thegraph.com/docs/en/developing/assemblyscript-api/#json-api
 */
export function getIsDataUnionValue(jsonString: string): boolean {
    let result: Result<JSONValue, boolean> = json.try_fromString(jsonString)
    if (result.isOk && result.value.kind == JSONValueKind.OBJECT) {
        let resultObj = result.value.toObject()
        let isDataUnionOrNull: JSONValue | null = resultObj.get("isDataUnion")
        return isDataUnionOrNull == null
            ? false
            : isDataUnionOrNull.toBool()
    }
    return false
}
