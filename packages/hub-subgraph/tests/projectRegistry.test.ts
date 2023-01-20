import { Bytes, Value } from "@graphprotocol/graph-ts"
import { assert, clearStore, describe, test, beforeAll } from "matchstick-as/assembly/index"
import { PaymentDetailsByChain, Project } from "../generated/schema"
import {
    handlePaymentDetailsByChainUpdate,
    handlePermissionUpdate,
    handleProjectCreation,
    handleProjectDeletion,
    handleProjectUpdate,
    handleStreamAdition,
    handleStreamRemoval,
    handleSubscriptionUpdate,
} from "../src/projectRegistry"
import {
    createPaymentDetailsByChainUpdatedEvent,
    createPermissionUpdatedEvent,
    createProjectCreatedEvent,
    createProjectDeletedEvent,
    createProjectUpdatedEvent,
    createStreamAddedEvent,
    createStreamedRemovedEvent,
    createSubscribedEvent,
} from "./helpers/mocked-event"
import {
    createPaymentDetailsByChainEntity,
    createPermissionEntity,
    createProjectEntity,
    createSubscriptionEntity
} from "./helpers/mocked-entity"

// handlers need to be exported from the test file when running test coverage
export {
    handleProjectCreation,
    handleProjectUpdate,
    handleProjectDeletion,
    handlePaymentDetailsByChainUpdate,
    handleStreamAdition,
    handleStreamRemoval,
    handlePermissionUpdate,
    handleSubscriptionUpdate,
} from "../src/projectRegistry"

const PROJECT_ENTITY_TYPE = "Project"
const PERMISSION_ENTITY_TYPE = "Permission"
const SUBSCRIPTION_ENTITY_TYPE = "TimeBasedSubscription"
const PAYMENT_DETAILS_ENTITY_TYPE = "PaymentDetailsByChain"

describe("Entity store", () => {
    const projectId = "projectId0"

    beforeAll(() => {
        clearStore()
    })

    test("Project Entity created", () => {
        createProjectEntity(projectId)

        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "id", projectId)
    })

    test("Can use entity.load() to retrieve entity from store", () => {
        const retrievedProject = Project.load(projectId)
        
        assert.stringEquals(projectId, retrievedProject!.get("id")!.toString())
    })

    test("Returns null when calling entity.load() if an entity doesn't exist", () => {
        const retrievedProject = Project.load("IDoNotExist")

        assert.assertNull(retrievedProject)
    })

    test("Can update entity that already exists using Entity.save()", () => {
        const project = Project.load(projectId) as Project

        project.set("metadata", Value.fromString("metadata-updated"))
        project.save()
        
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "metadata", "metadata-updated")
    })
})

describe("Mocked Project Events: create/update/delete", () => {
    beforeAll(() => {
        clearStore()
    })

    const projectId = "0x1234"
    const domainId = 1111
    const minimumSubscriptionSeconds = 1
    const metadata = "metadata-0x1234"
    
    test("handleProjectCreation", () => {
        const projectCreatedEvent = createProjectCreatedEvent(
            Bytes.fromHexString(projectId),
            [domainId],
            [], // TODO: add payment details
            minimumSubscriptionSeconds,
            metadata,
        )

        handleProjectCreation(projectCreatedEvent) // create event + feed event to mapping handler =  createProjectEntity(projectId)

        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "id", projectId)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "domainIds", `[${domainId}]`)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "minimumSubscriptionSeconds", `${minimumSubscriptionSeconds}`)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "metadata", metadata)
    })

    test("handleProjectUpdate", () => {
        const domainIdUpdated = 2222
        const minimumSubscriptionSecondsNew = 5
        const metadataNew = "metadata-0x1234-updated"
        const projectUpdatedEvent = createProjectUpdatedEvent(
            Bytes.fromHexString(projectId),
            [domainIdUpdated],
            [], // TODO: add payment details
            minimumSubscriptionSecondsNew,
            metadataNew,
        )
    
        handleProjectUpdate(projectUpdatedEvent)

        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "domainIds", `[${domainIdUpdated}]`)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "minimumSubscriptionSeconds", `${minimumSubscriptionSecondsNew}`)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "metadata", metadataNew)
    })

    test("handleProjectDeletion - positivetest", () => {
        const projectDeletedEvent = createProjectDeletedEvent(Bytes.fromHexString(projectId))

        handleProjectDeletion(projectDeletedEvent)

        assert.notInStore(PROJECT_ENTITY_TYPE, projectId)
    })
})

describe("Mocked Stream Events: add/remove", () => {
    const projectId = "0x123456"
    const streamId1 = "stream1"
    const streamId2 = "stream2"
    const streamId3 = "stream3"

    beforeAll(() => {
        clearStore()
    })

    test("Project Entity created", () => {
        createProjectEntity(projectId)

        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "id", projectId)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "streams", "[]")
    })
    
    test("handleStreamAdition", () => {
        const streamAddedEvent1 = createStreamAddedEvent(Bytes.fromHexString(projectId), streamId1)
        const streamAddedEvent2 = createStreamAddedEvent(Bytes.fromHexString(projectId), streamId2)
        const streamAddedEvent3 = createStreamAddedEvent(Bytes.fromHexString(projectId), streamId3)
        
        handleStreamAdition(streamAddedEvent1)
        handleStreamAdition(streamAddedEvent2)
        handleStreamAdition(streamAddedEvent3)

        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "streams", `[${streamId1}, ${streamId2}, ${streamId3}]`)
    })

    test("handleStreamRemoval", () => {
        const streamRemovedEvent2 = createStreamedRemovedEvent(Bytes.fromHexString(projectId), streamId2)

        handleStreamRemoval(streamRemovedEvent2)

        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "streams", `[${streamId1}, ${streamId3}]`)
    })
})

describe("Mocked Permission Events", () => {
    const projectId = "0x1234"
    const userAddress = "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab"
    const permissionId = "0x1234-0xdc353aa3d81fc3d67eb49f443df258029b01d8ab" // projectId + '-' + userAddress
    
    beforeAll(() => {
        clearStore()
    })

    test("Project Entity created", () => {
        createProjectEntity(projectId)

        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
    })

    test("Permission entity created", () => {
        createPermissionEntity(projectId, permissionId, userAddress, false, false, false, false)

        assert.entityCount(PERMISSION_ENTITY_TYPE, 1)
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "id", permissionId)
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "userAddress", userAddress)
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "project", projectId)
        // subscription linked to Project
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "permissions", `[${permissionId}]`)
        // permissions are initially disabled
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "canBuy", "false")
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "canDelete", "false")
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "canEdit", "false")
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "canGrant", "false")
    })

    test("handlePermissionUpdate", () => {
        const permissionUpdatedEvent = createPermissionUpdatedEvent(
            userAddress,
            Bytes.fromHexString(projectId),
            true, // canBuy
            true, // canDelete
            true, // canEdit
            true, // canGrant
        )

        handlePermissionUpdate(permissionUpdatedEvent)

        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "canBuy", "true")
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "canDelete", "true")
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "canEdit", "true")
        assert.fieldEquals(PERMISSION_ENTITY_TYPE, permissionId, "canGrant", "true")
    })
})

describe("Mocked Subscription Events", () => {
    const projectId = "0x123456"
    const subscriber = "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab"
    const subscriptionId = "0x123456-0xdc353aa3d81fc3d67eb49f443df258029b01d8ab" // projectId + '-' + subscriber
    const endTimestamp = 1666981001

    beforeAll(() => {
        clearStore()
    })

    test("Project Entity created", () => {
        createProjectEntity(projectId)

        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
    })

    test("Subscription Entity created", () => {
        createSubscriptionEntity(projectId, subscriptionId, subscriber, endTimestamp)

        assert.entityCount(SUBSCRIPTION_ENTITY_TYPE, 1)
        assert.fieldEquals(SUBSCRIPTION_ENTITY_TYPE, subscriptionId, "id", subscriptionId)
        assert.fieldEquals(SUBSCRIPTION_ENTITY_TYPE, subscriptionId, "userAddress", subscriber)
        assert.fieldEquals(SUBSCRIPTION_ENTITY_TYPE, subscriptionId, "project", projectId)
        assert.fieldEquals(SUBSCRIPTION_ENTITY_TYPE, subscriptionId, "endTimestamp", `${endTimestamp}`)
        // subscription linked to Project
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "subscriptions", `[${subscriptionId}]`)
        // subscription end timestamp set
        assert.fieldEquals(SUBSCRIPTION_ENTITY_TYPE, subscriptionId, "endTimestamp", `${endTimestamp}`)
    })

    test("handleSubscriptionUpdate", () => {
        const newEndTimestamp = 1666982002
        const subscribedEvent = createSubscribedEvent(
            Bytes.fromHexString(projectId),
            subscriber,
            newEndTimestamp
        )

        handleSubscriptionUpdate(subscribedEvent)

        assert.fieldEquals(SUBSCRIPTION_ENTITY_TYPE, subscriptionId, "endTimestamp", `${newEndTimestamp}`)
    })
})

describe("Mocked PaymentDetailsByChain Events", () => {
    const projectId = "0x123456"
    const domainId = 1234
    const beneficiary = "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab"
    const pricingTokenAddress = "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab"
    const paymentId = "0x123456-1234" // projectId + '-' + domainId
    const pricePerSecond = 3

    beforeAll(() => {
        clearStore()
    })

    test("Project Entity created", () => {
        createProjectEntity(projectId)

        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
    })

    test("PaymentDetailsByChain Entity created", () => {
        createPaymentDetailsByChainEntity(projectId, paymentId, beneficiary, pricingTokenAddress, pricePerSecond)

        assert.entityCount(PAYMENT_DETAILS_ENTITY_TYPE, 1)
        assert.fieldEquals(PAYMENT_DETAILS_ENTITY_TYPE, paymentId, "id", paymentId)
        assert.fieldEquals(PAYMENT_DETAILS_ENTITY_TYPE, paymentId, "project", projectId)
        assert.fieldEquals(PAYMENT_DETAILS_ENTITY_TYPE, paymentId, "beneficiary", beneficiary)
        assert.fieldEquals(PAYMENT_DETAILS_ENTITY_TYPE, paymentId, "pricingTokenAddress", pricingTokenAddress)
        assert.fieldEquals(PAYMENT_DETAILS_ENTITY_TYPE, paymentId, "pricePerSecond", `${pricePerSecond}`)
        // payment details by chain linked to Project
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "paymentDetails", `[${paymentId}]`)
    })

    test("handlePaymentDetailsByChainUpdate", () => {
        const pricePerSecondNew = 4
        const paymentEvent = createPaymentDetailsByChainUpdatedEvent(
            Bytes.fromHexString(projectId),
            domainId,
            beneficiary,
            pricingTokenAddress,
            pricePerSecondNew
        )

        handlePaymentDetailsByChainUpdate(paymentEvent)

        assert.fieldEquals(PAYMENT_DETAILS_ENTITY_TYPE, paymentId, "pricePerSecond", `${pricePerSecondNew}`)
    })
})
