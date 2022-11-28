import { Bytes, Value } from "@graphprotocol/graph-ts"
import { assert, clearStore, describe, test, beforeAll } from "matchstick-as/assembly/index"
import { ProjectPurchase } from "../generated/schema"
import {
    handleProjectPurchase,
} from "../src/marketplaceV4"
import {
    createProjectPurchasedEvent,
} from "./helpers/mocked-event"
import {
    createProjectEntity,
    createProjectPurchaseEntity,
} from "./helpers/mocked-entity"

// handlers need to be exported from the test file when running test coverage
export {
    handleProjectPurchase,
} from "../src/marketplaceV4"

const PROJECT_ENTITY_TYPE = "Project"
const PROJECT_PURCHASE_ENTITY_TYPE = "ProjectPurchase"

describe("ProjectPurchase entity store", () => {
    const projectId = "0x1234"
    const subscriber = "0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4"
    const projectPurchaseId = "0x1234-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4-1"
    const subscriptionSeconds = 200
    const price = 198
    const fee = 2
    const purchasedAt = 20221122

    beforeAll(() => {
        clearStore()
    })

    test("Entity created", () => {
        createProjectPurchaseEntity(projectId, projectPurchaseId, subscriber, subscriptionSeconds, price, fee, purchasedAt)

        assert.entityCount(PROJECT_PURCHASE_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_PURCHASE_ENTITY_TYPE, projectPurchaseId, "id", projectPurchaseId)
    })

    test("Can use entity.load() to retrieve entity from store", () => {
        const retrievedProjectPurchase = ProjectPurchase.load(projectPurchaseId)
        
        assert.stringEquals(projectPurchaseId, retrievedProjectPurchase!.get("id")!.toString())
    })

    test("Returns null when calling entity.load() if entity doesn't exist", () => {
        const retrievedProjectPurchase = ProjectPurchase.load("IDoNotExist")

        assert.assertNull(retrievedProjectPurchase)
    })

    test("Can update entity that already exists using entity.save()", () => {
        const projectPurchase = ProjectPurchase.load(projectPurchaseId) as ProjectPurchase
        const newSubscriber = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" // vitalik.eth

        projectPurchase.set("subscriber", Value.fromString(newSubscriber))
        projectPurchase.save()
        
        assert.fieldEquals(PROJECT_PURCHASE_ENTITY_TYPE, projectPurchaseId, "subscriber", newSubscriber)
    })
})

describe("Mocked MarketplaceV4 Events: ProjectPurchased", () => {
    const projectId = "0x123456"
    const subscriber = "0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4"
    const projectPurchaseId = "0x123456-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4-1" // projectId-subscriber-purchasesCount
    const subscriptionSeconds = 200
    const price = 198
    const fee = 2
    
    beforeAll(() => {
        clearStore()
    })

    test("Project Entity created", () => {
        createProjectEntity(projectId)

        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "id", projectId)
    })

    test("handleProjectPurchase", () => {
        const event = createProjectPurchasedEvent(Bytes.fromHexString(projectId), subscriber, subscriptionSeconds, price, fee)

        handleProjectPurchase(event)

        assert.entityCount(PROJECT_PURCHASE_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_PURCHASE_ENTITY_TYPE, projectPurchaseId, "id", projectPurchaseId)
        assert.fieldEquals(PROJECT_PURCHASE_ENTITY_TYPE, projectPurchaseId, "subscriber", subscriber)
        assert.fieldEquals(PROJECT_PURCHASE_ENTITY_TYPE, projectPurchaseId, "subscriptionSeconds", `${subscriptionSeconds}`)
        assert.fieldEquals(PROJECT_PURCHASE_ENTITY_TYPE, projectPurchaseId, "price", `${price}`)
        assert.fieldEquals(PROJECT_PURCHASE_ENTITY_TYPE, projectPurchaseId, "fee", `${fee}`)
        // purchases linked to Project
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "purchases", `[${projectPurchaseId}]`)
    })
})
