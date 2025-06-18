/* eslint-disable quotes */
import { upgrades, ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils, Wallet, constants as ethersConstants, BigNumber } from "ethers"
import { signTypedData, SignTypedDataVersion, TypedMessage } from '@metamask/eth-sig-util'

import type { DATAv2, MinimalForwarder, ProjectRegistryV1 } from "../../../typechain"
import type { StreamRegistry } from "@streamr/network-contracts"
import { types } from "./constants"

const { id, hexlify, parseEther, toUtf8Bytes, zeroPad } = utils
const { getContractFactory } = hardhatEthers

export const log = (..._: unknown[]): void => { /* skip logging */ }
// export const { log } = console

enum StreamRegistryPermissionType { Edit, Delete, Publish, Subscribe, Grant }

describe('ProjectRegistryV1', (): void => {
    let admin: Wallet
    let user1: Wallet
    let user2: Wallet
    let user3: Wallet
    let beneficiary: Wallet
    let trusted: Wallet
    let forwarder: Wallet

    const projectIdbytesNonExistent = hexlify(zeroPad(toUtf8Bytes('notexistentproject'), 32))
    const streamIdNonExistent = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266/projects/1000000'
    const streamIds: string[] = []
    let streamId: string
    let streamId1: string
    const metadata = 'testmetadata'

    enum permissionType { Buy, Delete, Edit, Grant }
    const permission1 = {canBuy: true, canDelete: true, canEdit: true, canGrant: true}
    const permission2 = {canBuy: true, canDelete: true, canEdit: true, canGrant: true}

    // type PaymentDetailsByChain = [
    //     beneficiary: string,
    //     pricingTokenAddress: string,
    //     pricePerSecond: BigNumber
    // ]
    const domainIds: number[] = []
    const paymentDetailsDefault: any[] = [] // PaymentDetailsByChain[]
    const paymentDetailsFreeProject: any[] = [] // PaymentDetailsByChain[]

    let registry: ProjectRegistryV1
    let minimalForwarder: MinimalForwarder
    let streamRegistry: StreamRegistry
    let token: DATAv2

    before(async (): Promise<void> => {
        [admin, user1, user2, user3, beneficiary, trusted, forwarder] = await hardhatEthers.getSigners() as unknown as Wallet[]
        await deployERC20()
        await deployMinimalForwarder()
        await deployStreamRegistryAndCreateStreams()
        await deployProjectRegistry()

        const streamRegistryTrustedRole = await streamRegistry.TRUSTED_ROLE()
        await streamRegistry.connect(admin).grantRole(streamRegistryTrustedRole, registry.address)

        domainIds.push(0x706f6c79) // polygon domain id assigned by hyperlane
        paymentDetailsDefault.push([
            beneficiary.address, // beneficiary
            token.address, // pricingTokenAddress
            BigNumber.from(2) // pricePerSecond
        ])
        paymentDetailsFreeProject.push([
            beneficiary.address, // beneficiary
            token.address, // pricingTokenAddress
            BigNumber.from(0) // pricePerSecond
        ])
    })

    async function deployERC20(): Promise<void> {
        const tokenFactory = await getContractFactory("DATAv2", admin)
        token = await tokenFactory.deploy() as DATAv2
        await token.grantRole(id("MINTER_ROLE"), admin.address)
        await token.mint(admin.address, parseEther("1000"))
    }

    async function deployMinimalForwarder(): Promise<void> {
        const factory = await getContractFactory('MinimalForwarder', forwarder)
        minimalForwarder = await factory.deploy() as MinimalForwarder
    }

    const createStream = async (id?: string, creator = admin): Promise<string> => {
        // create streams using the StreamRegistry contract (will give creator all permisisons to the stream)
        const streamPath = '/projects/' + (id ?? Date.now())
        const streamMetadata = `{"date": "${new Date().toLocaleString()}", "creator": "${creator.address}"}`
        await(await streamRegistry.connect(creator)
            .createStream(streamPath, streamMetadata)).wait()
        const streamId = creator.address.toLowerCase() + streamPath
        log('Stream created (streamId: %s)', streamId)
        return streamId
    }

    async function deployStreamRegistryAndCreateStreams(): Promise<void> {
        const contractFactory = await getContractFactory("StreamRegistryV5", admin)
        const contractFactoryTx = await upgrades.deployProxy(
            contractFactory,
            ["0x0000000000000000000000000000000000000000", minimalForwarder.address],
            { kind: 'uups' })
        streamRegistry = await contractFactoryTx.deployed() as StreamRegistry

        for (let i = 0; i < 10; i++) {
            const s = await createStream(i.toString())
            streamIds.push(s)
        }

        streamId = streamIds[0]
        streamId1 = streamIds[1]
    }

    async function deployProjectRegistry(): Promise<void> {
        const contractFactory = await getContractFactory("ProjectRegistryV1", admin)
        const contractFactoryTx = await upgrades.deployProxy(contractFactory, [streamRegistry.address], { kind: 'uups' })
        registry = await contractFactoryTx.deployed() as ProjectRegistryV1

        const trustedRole = await registry.getTrustedRole()
        await registry.grantRole(trustedRole, trusted.address)

        const trustedForwarderRole = await registry.TRUSTED_FORWARDER_ROLE()
        await (await registry.grantRole(trustedForwarderRole, minimalForwarder.address)).wait()
    }

    async function createProject({
        projectId = generateBytesId(),
        chains = domainIds,
        payment = paymentDetailsDefault,
        streamIds = [],
        minimumSubscriptionSeconds = 1,
        isPublicPurchable = true,
        metadata = "",
        creator = admin
    } = {}): Promise<string> {
        await registry.connect(creator)
            .createProject(projectId, chains, payment, streamIds, minimumSubscriptionSeconds, isPublicPurchable, metadata)
        log("   - created project: ", projectId)
        return projectId
    }

    function generateBytesId(): string {
        const name = 'project-' + Math.round(Math.random() * 1000000)
        return hexlify(zeroPad(toUtf8Bytes(name), 32))
    }

    describe('Project management', (): void => {
        it("createProject - positivetest - creates a project with correct params", async () => {
            const minimumSubscriptionSeconds = 1
            const isPublicPurchable = false
            const projectIdbytes = generateBytesId()

            await expect(registry.createProject(
                projectIdbytes,
                domainIds,
                paymentDetailsDefault,
                [streamId],
                minimumSubscriptionSeconds,
                isPublicPurchable,
                metadata))
                .to.emit(registry, "ProjectCreated")
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, admin.address, true, true, true, true)

            const res = await registry.getProject(projectIdbytes, domainIds)
            const actual = String([
                res[0], // payment details
                res[1].toNumber(), // minimum subscription seconds
                res[2], // metadata
                res[3], // streams added to project
            ])
            const expected = String([
                paymentDetailsDefault,
                minimumSubscriptionSeconds,
                metadata,
                [streamId], // streams added to project
            ])
            expect(actual).to.equal(expected)
        })

        it("createProject - negativetest - fails for empty project ID", async () => {
            const projectIdEmptyString = hexlify(zeroPad(toUtf8Bytes(''), 32))
            await expect(registry.createProject(projectIdEmptyString, domainIds, paymentDetailsDefault, [], 1, true, "meta"))
                .to.be.revertedWith('error_nullProjectId')
        })

        it("createProject - positivetest - can create free projects", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-create-free'), 32))
            // free projects are supported on project creation
            expect(await registry.createProject(id, domainIds, paymentDetailsFreeProject, [], 1, true, metadata))
                .to.emit(registry, "ProjectCreated")
                .withArgs(id, domainIds, 1, metadata)
        })

        it("updateProject - positivetest - can update to free projects", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-update-free'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata)
            // free projects are supported on project update
            await expect(registry.updateProject(id, domainIds, paymentDetailsFreeProject, [], 2, metadata))
                .to.emit(registry, "ProjectUpdated")

            const projectUpdated = await registry.getProject(id, domainIds)
            const pricePerSecond = projectUpdated[0][0].pricePerSecond
            expect(pricePerSecond).to.equal(0)
        })

        it("createProject - negativetest - fails for existing projects", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-double-create'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata)
            await expect(registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata))
                .to.be.revertedWith('error_alreadyExists')
        })

        it("createProject - negativetest - chainIds and paiment details by chain have different lengths", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-invalid-array-lenghts'), 32))
            await expect(registry.createProject(id, [8997], [], [], 1, true, metadata))
                .to.be.revertedWith('error_invalidPaymentDetailsByChain')
        })

        it("canBuyProject - positivetest - public purchable", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-can-buy-project'), 32))
            const isPublicPurchable = true
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, isPublicPurchable, metadata)
            expect(await registry.canBuyProject(id, user1.address))
                .to.be.true
        })

        it("canBuyProject - positivetest - non-public purchable", async () => {
            const projectId = await createProject({ isPublicPurchable: false })
            await registry.enablePermissionType(projectId, user1.address, permissionType.Buy)
            expect(await registry.canBuyProject(projectId, user1.address))
                .to.be.true
        })

        it("canBuyProject - negativetest - non-public purchable", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-cant-buy-non-public'), 32))
            const isPublicPurchable = false
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, isPublicPurchable, metadata)
            expect(await registry.canBuyProject(id, user1.address))
                .to.be.false
        })

        it("deleteProject, updateProject - negativetest - can only be modified if user has delete/edit permission", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-owner'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata)
            await expect(registry.connect(user1).deleteProject(id))
                .to.be.revertedWith("error_noDeletePermission")
            await expect(registry.connect(user1).updateProject(id, domainIds, paymentDetailsDefault, [], 2, metadata))
                .to.be.revertedWith("error_noEditPermission")
        })

        it("deleteProject - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-delete'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata)

            await expect(registry.deleteProject(id))
                .to.emit(registry, "ProjectDeleted")
                .withArgs(id)

            await expect(registry.getProject(id, domainIds))
                .to.be.revertedWith("error_projectDoesNotExist")
        })

        it("deleteProject - negativetest - no Delete permission", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-delete-fails'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata)
            await expect(registry.connect(user1).deleteProject(id))
                .to.be.revertedWith("error_noDeletePermission")
        })

        it("deleteProject - negativetest - fails if project does not exist", async () => {
            await expect(registry.deleteProject(projectIdbytesNonExistent))
                .to.be.revertedWith("error_projectDoesNotExist")
        })

        it("deleteProject - positivetest - project can NOT be re-created with the same id", async () => {
            const projectId = await createProject()
            await registry.deleteProject(projectId)
            await expect(registry.createProject(projectId, domainIds, paymentDetailsDefault, streamIds, 1, true, 'metadata'))
                .to.be.revertedWith("error_usedProjectId")
        })

        it("updateProject - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-update'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, [streamId], 1, true, metadata)
            const project = await registry.getProject(id, domainIds)
            const minimumSubscriptionSeconds = project[1]
            const streamIds = project[3]

            await expect(registry.updateProject(id, domainIds, paymentDetailsDefault, [streamId1], 2, metadata))
                .to.emit(registry, "ProjectUpdated")
            const projectUpdated = await registry.getProject(id, domainIds)
            const minimumSubscriptionSecondsUpdated = projectUpdated[1]
            const streamIdsUpdated = projectUpdated[3]

            expect(minimumSubscriptionSeconds).to.equal(1)
            expect(minimumSubscriptionSecondsUpdated).to.equal(2)
            expect(streamIds).to.deep.equal([streamId])
            expect(streamIdsUpdated).to.deep.equal([streamId1])
        })

        it("setStreams, overlapping new and old streams - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-setStreams1'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, streamIds.slice(0, 5), 1, true, metadata)
            const tr = await (await registry.setStreams(id, streamIds.slice(3))).wait()
            expect(tr.events?.filter((e) => e.event === "StreamAdded" || e.event === "StreamRemoved").map((e) => [e.event, e.args])).to.deep.equal([
                ["StreamRemoved", [id, streamIds[0]]],
                ["StreamRemoved", [id, streamIds[1]]],
                ["StreamRemoved", [id, streamIds[2]]],
                ["StreamAdded", [id, streamIds[5]]],
                ["StreamAdded", [id, streamIds[6]]],
                ["StreamAdded", [id, streamIds[7]]],
                ["StreamAdded", [id, streamIds[8]]],
                ["StreamAdded", [id, streamIds[9]]],
            ])
        })

        it("setStreams, remove all old streams - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-setStreams2'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, streamIds.slice(0, 5), 1, true, metadata)
            const tr = await (await registry.setStreams(id, streamIds.slice(7))).wait()
            expect(tr.events?.filter((e) => e.event === "StreamAdded" || e.event === "StreamRemoved").map((e) => [e.event, e.args])).to.deep.equal([
                ["StreamRemoved", [id, streamIds[0]]],
                ["StreamRemoved", [id, streamIds[1]]],
                ["StreamRemoved", [id, streamIds[2]]],
                ["StreamRemoved", [id, streamIds[3]]],
                ["StreamRemoved", [id, streamIds[4]]],
                ["StreamAdded", [id, streamIds[7]]],
                ["StreamAdded", [id, streamIds[8]]],
                ["StreamAdded", [id, streamIds[9]]],
            ])
        })

        it("setStreams, remove all streams - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-setStreams3'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, streamIds.slice(0, 5), 1, true, metadata)
            const tr = await (await registry.setStreams(id, [])).wait()
            expect(tr.events?.filter((e) => e.event === "StreamAdded" || e.event === "StreamRemoved").map((e) => [e.event, e.args])).to.deep.equal([
                ["StreamRemoved", [id, streamIds[0]]],
                ["StreamRemoved", [id, streamIds[1]]],
                ["StreamRemoved", [id, streamIds[2]]],
                ["StreamRemoved", [id, streamIds[3]]],
                ["StreamRemoved", [id, streamIds[4]]],
            ])
        })

        it("setStreams, start with no streams - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-setStreams4'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata)
            const tr = await (await registry.setStreams(id, streamIds.slice(7))).wait()
            expect(tr.events?.filter((e) => e.event === "StreamAdded" || e.event === "StreamRemoved").map((e) => [e.event, e.args])).to.deep.equal([
                ["StreamAdded", [id, streamIds[7]]],
                ["StreamAdded", [id, streamIds[8]]],
                ["StreamAdded", [id, streamIds[9]]],
            ])
        })

        it("setStreams, deals with duplicates in new streams - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-setStreams5'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, streamIds.slice(0, 5), 1, true, metadata)
            const tr = await (await registry.setStreams(id, streamIds.slice(3).concat(streamIds.slice(3)).concat(streamIds.slice(7)))).wait()
            expect(tr.events?.filter((e) => e.event === "StreamAdded" || e.event === "StreamRemoved").map((e) => [e.event, e.args])).to.deep.equal([
                ["StreamRemoved", [id, streamIds[0]]],
                ["StreamRemoved", [id, streamIds[1]]],
                ["StreamRemoved", [id, streamIds[2]]],
                ["StreamAdded", [id, streamIds[5]]],
                ["StreamAdded", [id, streamIds[6]]],
                ["StreamAdded", [id, streamIds[7]]],
                ["StreamAdded", [id, streamIds[8]]],
                ["StreamAdded", [id, streamIds[9]]],
            ])
        })

        // this test really checks that the indices were correctly updated by setStreams; removeStream is the only function that really uses the index
        it("setStreams + removeStream - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-setStreams6'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, streamIds.slice(0, 5), 1, true, metadata)
            const tr = await (await registry.setStreams(id, streamIds.slice(3, 6))).wait()
            expect(tr.events?.filter((e) => e.event === "StreamAdded" || e.event === "StreamRemoved").map((e) => [e.event, e.args])).to.deep.equal([
                ["StreamRemoved", [id, streamIds[0]]],
                ["StreamRemoved", [id, streamIds[1]]],
                ["StreamRemoved", [id, streamIds[2]]],
                ["StreamAdded", [id, streamIds[5]]],
            ])

            const p = await registry.getProject(id, domainIds)
            expect(p.streams).to.have.members(streamIds.slice(3, 6)) // ignore order

            await expect(registry.removeStream(id, streamIds[3]))
                .to.emit(registry, 'StreamRemoved').withArgs(id, streamIds[3])

            const p2 = await registry.getProject(id, domainIds)
            expect(p2.streams).to.have.members(streamIds.slice(4, 6)) // ignore order
        })

        it("updateProject - negativetest - throws for non existing projects", async () => {
            await expect(registry
                .updateProject(projectIdbytesNonExistent, domainIds, paymentDetailsDefault, [], 2, metadata))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it("updatePaymentDetailsByChain - positivetest", async () => {
            const projectId = await createProject({chains: [], payment: []})
            const domainId = 8997
            const beneficiaryAddress = beneficiary.address
            const pricingTokenAddress = token.address
            const pricePerSecond = BigNumber.from(2)

            await registry.updatePaymentDetailsByChain(projectId, domainId, beneficiaryAddress, pricingTokenAddress, pricePerSecond)
            const [beneficiaryAddressActual, pricingTokenAddressActual, pricePerSecondActual] =
                await registry.getPaymentDetailsByChain(projectId, domainId)

            expect(beneficiaryAddress).to.equal(beneficiaryAddressActual)
            expect(pricingTokenAddress).to.equal(pricingTokenAddressActual)
            expect(pricePerSecond).to.equal(pricePerSecondActual)
        })

        it("updatePaymentDetailsByChain - negativetest - non-existing projects", async () => {
            await expect(registry.updatePaymentDetailsByChain(projectIdbytesNonExistent, 8997, beneficiary.address, token.address, BigNumber.from(2)))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it("updatePaymentDetailsByChain - negativetest - no Edit permission", async () => {
            const projectId = await createProject()
            await expect(registry.connect(user1).updatePaymentDetailsByChain(projectId, 8997, beneficiary.address, token.address, BigNumber.from(2)))
                .to.be.revertedWith('error_noEditPermission')
        })

        it("getPaymentDetailsByChain - negativetest - fails if project does not exist", async () => {
            await expect(registry.getPaymentDetailsByChain(projectIdbytesNonExistent, 8997))
                .to.be.revertedWith('error_projectDoesNotExist')
        })
    })

    describe('Streams', (): void => {
        it('isStreamAdded - negativetest - fails if project does not exist', async (): Promise<void> => {
            await expect(registry.isStreamAdded(projectIdbytesNonExistent, streamId))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('addStream - positivetest - adds stream and updates permissions', async (): Promise<void> => {
            const projectIdbytes = await createProject()

            expect(await registry.addStream(projectIdbytes, streamId))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, admin.address, true, true, true, true)
                .to.emit(registry, 'StreamAdded')
                .withArgs(projectIdbytes, streamId)
            expect(await registry.getPermission(projectIdbytes, admin.address))
                .to.deep.equal([true, true, true, true])
        })

        it('addStream - negativetest - fails without Grant permission for stream', async (): Promise<void> => {
            // admin creates project => admin has project permissions
            const id = hexlify(zeroPad(toUtf8Bytes('add-stream-no-perm'), 32))
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata)

            // admin creates stream => admin has stream permissions
            await streamRegistry.createStream('/streampathadd', metadata)
            const streamid = admin.address.toLowerCase() + '/streampathadd'

            // grant Edit permission on project to user1
            await registry.enablePermissionType(id, user1.address, permissionType.Edit)

            // user1 does NOT have permissions on stream
            await expect(registry.connect(user1).addStream(id, streamid))
                .to.be.revertedWith('error_noGrantPermissionForStream')
        })

        it('addStream - negativetest - fails if stream was already added', async (): Promise<void> => {
            const projectIdbytes = await createProject()
            await registry.addStream(projectIdbytes, streamId)
            await expect(registry.addStream(projectIdbytes, streamId))
                .to.be.revertedWith('error_streamAlreadyAdded')
        })

        it('addStream - negativetest - fails if project does not exist', async (): Promise<void> => {
            await expect(registry.addStream(projectIdbytesNonExistent, streamId))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('addStreams - negativetest - fails if project does not exist', async (): Promise<void> => {
            await expect(registry.addStreams(projectIdbytesNonExistent, [streamId]))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('addStreams - negativetest - fails if user does not have Edit permission', async (): Promise<void> => {
            const projectId = await createProject()
            await expect(registry.connect(user1).addStreams(projectId, [streamId]))
                .to.be.revertedWith('error_noEditPermission')
        })

        it('removeStream - removes stream from project', async (): Promise<void> => {
            const projectIdbytes = await createProject()
            expect(await registry.isStreamAdded(projectIdbytes, streamId1))
                .to.be.false

            await registry.addStream(projectIdbytes, streamId1)
            expect(await registry.isStreamAdded(projectIdbytes, streamId1))
                .to.be.true
            expect(await registry.removeStream(projectIdbytes, streamId1))
                .to.emit(registry, 'StreamRemoved')
                .withArgs(projectIdbytes, streamId1)
            expect(await registry.isStreamAdded(projectIdbytes, streamId1))
                .to.be.false
        })

        it('removeStream - negativetest - fails if project does not exist', async (): Promise<void> => {
            await expect(registry.removeStream(projectIdbytesNonExistent, streamId))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('removeStream - negativetest - fails if user does not have Edit permission', async (): Promise<void> => {
            const projectId = await createProject()
            await expect(registry.connect(user1).removeStream(projectId, streamId))
                .to.be.revertedWith('error_noEditPermission')
        })

        it('removeStream - negativetest - fails if stream does not exist', async (): Promise<void> => {
            const projectId = await createProject()
            await expect(registry.removeStream(projectId, streamIdNonExistent))
                .to.be.revertedWith('error_streamNotFound')
        })

        it('removeStream - negativetest - fails if stream was not added to project', async (): Promise<void> => {
            const projectId = await createProject()
            await expect(registry.removeStream(projectId, streamId))
                .to.be.revertedWith('error_streamNotFound')
        })

        it('setStreams - negativetest - fails if project does not exist', async (): Promise<void> => {
            await expect(registry.setStreams(projectIdbytesNonExistent, [streamId]))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('setStreams - negativetest - fails if user does not have Edit permission', async (): Promise<void> => {
            const projectId = await createProject()
            await expect(registry.connect(user1).setStreams(projectId, [streamId]))
                .to.be.revertedWith('error_noEditPermission')
        })
    })

    describe('Subscription management', () => {
        it('getSubscription - positivetest', async () => {
            const id = await createProject()

            let subscription = await registry.getSubscription(id, admin.address)
            let isValid = subscription[0]
            let endTimestamp = subscription[1]
            expect(isValid)
                .to.be.false
            expect(endTimestamp)
                .to.equal(0)

            await registry.grantSubscription(id, 1, admin.address)
            subscription = await registry.getSubscription(id, admin.address)
            isValid = subscription[0]
            endTimestamp = subscription[1]
            expect(isValid)
                .to.be.true
            expect(endTimestamp)
                .to.be.gt(0)
        })

        it('getSubscription | getOwnSubscription - positivetest - return the same value when queries for the same subscriber', async () => {
            const id = await createProject({ creator: user1})
            await registry.connect(user1).grantSubscription(id, 1, user2.address)
            const subscription = await registry.getSubscription(id, user2.address)
            const ownSubscription = await registry.connect(user2).getOwnSubscription(id)

            expect(subscription[1]).to.equal(ownSubscription[1]) // endTimestamp
        })

        it('getOwnSubscription - negativetest', async () => {
            await expect(registry.getOwnSubscription(projectIdbytesNonExistent))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('getSubscription - negativetest', async () => {
            await expect(registry.getSubscription(projectIdbytesNonExistent, admin.address))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('grantSubscription - positivetest', async () => {
            const id = generateBytesId()
            const pricePerSecond = 1
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata)
            expect(await registry.addStream(id, streamId))
                .to.emit(registry, 'StreamAdded')
                .withArgs(id, streamId)

            // reset subscription to block.timestamp + 1
            await registry.grantSubscription(id, 1, user1.address)

            const subscriptionBefore = await registry.getSubscription(id, user1.address)
            const addSeconds = 100
            await expect(registry.grantSubscription(id, addSeconds, user1.address))
                .to.emit(registry, "Subscribed")
                .to.emit(streamRegistry, "PermissionUpdated")
            const subscriptionAfter = await registry.getSubscription(id, user1.address)
            expect(subscriptionAfter.endTimestamp)
                .to.equal(subscriptionBefore.endTimestamp.add(addSeconds / pricePerSecond))
        })

        it('grantSubscription - negativetest - fails if project does not exist', async () => {
            await expect(registry.grantSubscription(projectIdbytesNonExistent, 100, user1.address))
                .to.be.revertedWith("error_projectDoesNotExist")
        })

        it('grantSubscription - negativetest - must have Grant permission', async () => {
            const projectIdbytes = await createProject() // admin has Grant permission
            await expect(registry.connect(user1).grantSubscription(projectIdbytes, 100, user1.address))
                .to.be.revertedWith("error_noGrantPermissionOrNotTrusted")
        })

        it('grantSubscription - negativetest - must extend by greater than zero seconds', async () => {
            const id = await createProject()
            await registry.grantSubscription(id, 100, admin.address) // reset sub endTimestamp to block.timestamp + 100
            await expect(registry.grantSubscription(id, 0, admin.address))
                .to.be.revertedWith("error_topUpTooSmall")
        })
    })

    describe('Permissions', (): void => {
        it('getPermission - returns user permissions', async (): Promise<void> => {
            const projectIdbytes = await createProject()
            expect(await registry.getPermission(projectIdbytes, admin.address))
                .to.deep.equal([true, true, true, true])
        })

        it('getPermission - reverts if project does not exist', async (): Promise<void> => {
            await expect(registry.getPermission(projectIdbytesNonExistent, admin.address))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('setPermissionBooleans - fails is the project does not exist', async (): Promise<void> => {
            await expect(registry.setPermissionBooleans(projectIdbytesNonExistent, admin.address, true, true, true, true))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('setPermissionBooleans - reverts is user does not have grant permission', async (): Promise<void> => {
            const projectIdbytes = await createProject() // admin has Grant permission
            await expect(registry.connect(user2).setPermissionBooleans(projectIdbytes, admin.address, true, true, true, true))
                .to.be.revertedWith('error_noGrantPermission')
        })

        it('setPermissionBooleans', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin

            // user2 has no permissions on projectIdbytes
            expect(await registry.getPermission(projectIdbytes, user2.address))
                .to.deep.equal([false, false, false, false])
            // grant him all permissions
            expect(await registry.setPermissionBooleans(projectIdbytes, user2.address, true, true, true, true))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user2.address, true, true, true, true)
            // test all permissions were granted to user2
            expect(await registry.getPermission(projectIdbytes, user2.address))
                .to.deep.equal([true, true, true, true])
            // test if he can share, edit other permissions
            expect(await registry.connect(user2).setPermissionBooleans(projectIdbytes, admin.address, true, true, true, true))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, admin.address, true, true, true, true)
            expect(await registry.getPermission(projectIdbytes, admin.address))
                .to.deep.equal([true, true, true, true])
            // user2 now has permission to delete the project
            expect(await registry.connect(user2).deleteProject(projectIdbytes))
                .to.emit(registry, 'ProjectDeleted')
                .withArgs(admin.address)
        })

        it('enablePermissionType, hasPermissionType - positivetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            // user3 has no permissions on projectIdbytes
            expect (await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([false, false, false, false])

            expect (await registry.enablePermissionType(projectIdbytes, user3.address, permissionType.Buy))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user3.address, true, false, false, false)
            expect (await registry.hasPermissionType(projectIdbytes, user3.address, permissionType.Buy))
                .to.equal(true)

            expect (await registry.enablePermissionType(projectIdbytes, user3.address, permissionType.Delete))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user3.address, true, true, false, false)
            expect (await registry.hasPermissionType(projectIdbytes, user3.address, permissionType.Delete))
                .to.equal(true)

            expect (await registry.enablePermissionType(projectIdbytes, user3.address, permissionType.Edit))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user3.address, true, true, true, false)
            expect (await registry.hasPermissionType(projectIdbytes, user3.address, permissionType.Edit))
                .to.equal(true)

            expect (await registry.enablePermissionType(projectIdbytes, user3.address, permissionType.Grant))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user3.address, true, true, true, true)
            expect (await registry.hasPermissionType(projectIdbytes, user3.address, permissionType.Grant))
                .to.equal(true)

            // user3 has all permissions
            expect (await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([true, true, true, true])
        })

        it('enablePermissionType, hasPermissionType - negativetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            // set all premissions to false for user3 on projectIdbytes
            await registry.setPermissionBooleans(projectIdbytes, user3.address, false, false, false, false)
            expect (await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([false, false, false, false])

            // user3 does not have Grant permissions and can not grant any permissions
            await expect(registry.connect(user3).enablePermissionType(projectIdbytes, user3.address, permissionType.Buy))
                .to.be.revertedWith('error_noGrantPermission')
            await expect(registry.connect(user3).enablePermissionType(projectIdbytes, user3.address, permissionType.Delete))
                .to.be.revertedWith('error_noGrantPermission')
            await expect(registry.connect(user3).enablePermissionType(projectIdbytes, user3.address, permissionType.Edit))
                .to.be.revertedWith('error_noGrantPermission')
            await expect(registry.connect(user3).enablePermissionType(projectIdbytes, user3.address, permissionType.Grant))
                .to.be.revertedWith('error_noGrantPermission')
        })

        it('hasPermissionType - negativetest - fails if project does not exist', async (): Promise<void> => {
            await expect(registry.hasPermissionType(projectIdbytesNonExistent, admin.address, permissionType.Buy))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('enablePermissionType - negativetest - fails if project does not exist', async (): Promise<void> => {
            await expect(registry.enablePermissionType(projectIdbytesNonExistent, admin.address, permissionType.Buy))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('hasPermissionType - negativetest - reverts for invalid permission type', async (): Promise<void> => {
            const projectId = await createProject()
            await expect(registry.hasPermissionType(projectId, admin.address, 9)) // valid permissions are 0, 1, 2, 3
                .to.be.reverted
        })

        it('setPermissionsForMultipleUsers - positivetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            // user1 and user2 have all permissions set to false
            await registry.setPermissionBooleans(projectIdbytes, user1.address, false, false, false, false)
            expect(await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([false, false, false, false])
            await registry.setPermissionBooleans(projectIdbytes, user2.address, false, false, false, false)
            expect(await registry.getPermission(projectIdbytes, user2.address))
                .to.deep.equal([false, false, false, false])

            expect(await registry
                .setPermissionsForMultipleUsers(
                    projectIdbytes,
                    [user1.address, user2.address],
                    [permission1, permission2]))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user2.address, permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant)

            // user1 and user2 have all permissions updated
            expect(await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant])
            expect(await registry.getPermission(projectIdbytes, user2.address))
                .to.deep.equal([permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant])
        })

        it('setPermissionsForMultipleUsers - negativetest - fails if project does not exist', async (): Promise<void> => {
            await expect(registry.setPermissionsForMultipleUsers(
                projectIdbytesNonExistent,
                [user1.address],
                [permission1]))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('setPermissionsForMultipleUsers - negativetest - fails if user does not have Grant permission on the project', async (): Promise<void> => {
            const projectId = await createProject( {creator: user1})
            await expect(registry.connect(user2).setPermissionsForMultipleUsers(
                projectId,
                [user1.address],
                [permission1]))
                .to.be.revertedWith('error_noGrantPermission')
        })

        it('setPermissionsForMultipleUsers - negativetest - fails if users & permissions arrays have different lenghts', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            await expect(registry.setPermissionsForMultipleUsers(
                projectIdbytes,
                [user1.address],
                [permission1, permission2]))
                .to.be.revertedWith('error_invalidUserPermissionArrayLengths')
        })

        it('setPermissionsForMultipleProjects - positivetest', async (): Promise<void> => {
            const projectId1 = await createProject()
            const projectId2 = await createProject()
            await registry.setPermissionBooleans(projectId1, user1.address, false, false, false, false)
            await registry.setPermissionBooleans(projectId1, user2.address, false, false, false, false)
            await registry.setPermissionBooleans(projectId2, user1.address, false, false, false, false)
            await registry.setPermissionBooleans(projectId2, user2.address, false, false, false, false)

            await expect(registry.setPermissionsForMultipleProjects(
                [projectId1, projectId2],
                [[user1.address, user2.address], [user1.address, user2.address]],
                [[permission1, permission2], [permission1, permission2]]))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectId1, user1.address, permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectId1, user2.address, permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectId2, user1.address, permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectId2, user2.address, permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant)
        })

        it('setPermissionsForMultipleProjects - negativetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            await expect(registry.setPermissionsForMultipleProjects(
                [projectIdbytes],
                [[user1.address, user2.address], [user1.address, user2.address]],
                [[permission1, permission2], [permission1, permission2]]))
                .to.be.revertedWith('error_invalidProjectUserPermissionArrayLengths')
        })

        it('transferAllPermissionsToUser - positivetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            // user1 has all permissions
            await registry.setPermissionBooleans(projectIdbytes, user1.address, true, true, true, true)
            expect (await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([true, true, true, true])
            // user3 has no permissions
            await registry.setPermissionBooleans(projectIdbytes, user3.address, false, false, false, false)
            expect (await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([false, false, false, false])

            // transfer all permissions from user1 to user3
            await expect(registry.connect(user1).transferAllPermissionsToUser(projectIdbytes, user3.address))
                .to.emit(registry.connect(user3), 'PermissionUpdated')
                .withArgs(projectIdbytes, user3.address, true, true, true, true) // recipient (user3)
                .to.emit(registry.connect(user1), 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, false, false, false, false) // sender (user1)

            expect(await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([false, false, false, false])
            expect(await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([true, true, true, true])

            // user 2 and 3 both have perms
            await registry.setPermissionBooleans(projectIdbytes, user2.address, false, false, true, true)
            expect (await registry.getPermission(projectIdbytes, user2.address))
                .to.deep.equal([false, false, true, true])

            // transfer all permissions from user2 to user3
            // make sure positive ones are not overwritten
            await expect(registry.connect(user2).transferAllPermissionsToUser(projectIdbytes, user3.address))
                .to.emit(registry.connect(user3), 'PermissionUpdated')
                .withArgs(projectIdbytes, user3.address, true, true, true, true) // recipient (user3)
                .to.emit(registry.connect(user2), 'PermissionUpdated')
                .withArgs(projectIdbytes, user2.address, false, false, false, false) // sender (user2)

            expect(await registry.getPermission(projectIdbytes, user2.address))
                .to.deep.equal([false, false, false, false])
            expect(await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([true, true, true, true])
        })

        it('transferAllPermissionsToUser - negativetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            await expect(registry.connect(user1).transferAllPermissionsToUser(projectIdbytes, user2.address))
                .to.be.revertedWith('error_noPermissionToTransfer')
        })

        it('transferPermissionType - positivetest', async (): Promise<void> => {
            const projectIdbytes = await createProject({creator: user3}) // created by user3
            // user2 has no permissions, user3 has all permissions
            expect(await registry.getPermission(projectIdbytes, user2.address))
                .to.deep.equal([false, false, false, false])
            expect(await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([true, true, true, true])

            // transfer Buy permission form user3 to user2
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Buy))
                .to.emit(registry.connect(user3), 'PermissionUpdated')
                .withArgs(projectIdbytes, user2.address, true, false, false, false)

            // transfer Delete permission form user3 to user2
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Delete))
                .to.emit(registry.connect(user3), 'PermissionUpdated')
                .withArgs(projectIdbytes, user2.address, true, true, false, false)

            // transfer Edit permission form user3 to user2
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Edit))
                .to.emit(registry.connect(user3), 'PermissionUpdated')
                .withArgs(projectIdbytes, user2.address, true, true, true, false)

            // transfer Edit permission form user3 to user2
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Grant))
                .to.emit(registry.connect(user3), 'PermissionUpdated')
                .withArgs(projectIdbytes, user2.address, true, true, true, true)

            // user3 has transfered all permissions to user2
            expect(await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([false, false, false, false])
            expect(await registry.getPermission(projectIdbytes, user2.address))
                .to.deep.equal([true, true, true, true])
        })

        it('transferPermissionType - negativetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Buy))
                .to.be.revertedWith('error_noPermissionToTransfer')
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Delete))
                .to.be.revertedWith('error_noPermissionToTransfer')
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Edit))
                .to.be.revertedWith('error_noPermissionToTransfer')
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Grant))
                .to.be.revertedWith('error_noPermissionToTransfer')
        })

        it('transferPermissionType - negativetest - fails if project does not exist', async (): Promise<void> => {
            await expect(registry.transferPermissionType(projectIdbytesNonExistent, user2.address, permissionType.Buy))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('revokePermissionType - positivetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            // user1 has all permissions
            await registry.setPermissionBooleans(projectIdbytes, user1.address, true, true, true, true)
            expect (await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([true, true, true, true])

            expect(await registry.connect(user1).revokePermissionType(projectIdbytes, user1.address, permissionType.Buy))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, false, true, true, true)

            expect(await registry.connect(user1).revokePermissionType(projectIdbytes, user1.address, permissionType.Delete))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, false, false, true, true)

            expect(await registry.connect(user1).revokePermissionType(projectIdbytes, user1.address, permissionType.Edit))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, false, false, false, true)

            expect(await registry.connect(user1).revokePermissionType(projectIdbytes, user1.address, permissionType.Grant))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, false, false, false, false)

            // user1 revoked all his permisions
            expect (await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([false, false, false, false])
        })

        it('revokePermissionType - negativetest - fails if the project does not exist', async (): Promise<void> => {
            await expect(registry.revokePermissionType(projectIdbytesNonExistent, user1.address, permissionType.Buy))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('revokePermissionType - negativetest - fails if user does not have grant permission on the project', async (): Promise<void> => {
            const projectId = await createProject({ creator: user1 })
            await expect(registry.connect(user2).revokePermissionType(projectId, user1.address, permissionType.Buy))
                .to.be.revertedWith('error_noGrantPermission')
        })

        it('revokeAllPermissionsForUser - positivetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // created by admin
            // grant all premissions for user3 on projectIdbytes
            await registry.setPermissionBooleans(projectIdbytes, user3.address, true, true, true, true)
            expect (await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([true, true, true, true])

            expect(await registry.revokeAllPermissionsForUser(projectIdbytes, user3.address))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user3.address, false, false, false, false)

            // user3 has no permissions
            expect (await registry.getPermission(projectIdbytes, user3.address))
                .to.deep.equal([false, false, false, false])
        })

        it('revokeAllPermissionsForUser - negativetest - fails if the project does not exist', async (): Promise<void> => {
            await expect(registry.revokeAllPermissionsForUser(projectIdbytesNonExistent, admin.address))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('revokeAllPermissionsForUser - negativetest', async (): Promise<void> => {
            const projectIdbytes = await createProject({creator: user3}) // created by user3 => has all permissions
            // set Grant permission to false for user3 on projectIdbytes
            await registry.connect(user3).setPermissionBooleans(projectIdbytes, user3.address, true, true, true, false)
            expect (await registry.hasPermissionType(projectIdbytes, user3.address, permissionType.Grant))
                .to.be.false

            await expect(registry.connect(user3).revokeAllPermissionsForUser(projectIdbytes, user3.address))
                .to.be.revertedWith('error_noGrantPermission')
        })
    })

    describe('Metatransactions', (): void => {
        async function createProjectAndStream(signerAddress: string): Promise<any> {
            // create project and stream
            const projectIdbytes = await createProject() // created by admin
            const streamPathMetatx = '/streampathmetatx' + Wallet.createRandom().address
            const streamMetadataMetatx = 'streamMetadataMetatx' + Wallet.createRandom().address
            await streamRegistry.createStream(streamPathMetatx, streamMetadataMetatx) // created by admin => has all permissions
            const streamIdMetatx = admin.address.toLowerCase() + streamPathMetatx
            // enable Edit permission on the project and Grant permission on the stream to signer
            await registry.enablePermissionType(projectIdbytes, signerAddress, permissionType.Edit)
            await streamRegistry.grantPermission(streamIdMetatx, signerAddress, StreamRegistryPermissionType.Grant)

            return { projectIdbytes, streamIdMetatx }
        }

        async function prepareAddStreamMetatx(minimalForwarder: MinimalForwarder, signerWallet: Wallet, signKey: string, gas = '1000000') {
            const { projectIdbytes, streamIdMetatx } = await createProjectAndStream(signerWallet.address)
            // signerWallet is creating and signing transaction, forwarder is posting it and paying for gas
            const data = registry.connect(signerWallet).interface.encodeFunctionData('addStream', [projectIdbytes, streamIdMetatx])
            const req = {
                from: signerWallet.address,
                to: registry.address,
                value: '0',
                gas,
                nonce: (await minimalForwarder.getNonce(signerWallet.address)).toString(),
                data
            }
            const d: TypedMessage<any> = {
                types,
                domain: {
                    name: 'MinimalForwarder',
                    version: '0.0.1',
                    chainId: (await hardhatEthers.provider.getNetwork()).chainId,
                    verifyingContract: minimalForwarder.address,
                },
                primaryType: 'ForwardRequest',
                message: req,
            }
            const options = {
                data: d,
                privateKey: utils.arrayify(signKey) as Buffer,
                version: SignTypedDataVersion.V4,
            }
            const sign = signTypedData(options) // admin
            return {req, sign, projectIdbytes, streamIdMetatx}
        }

        it('isTrustedForwarder - positivetest', async (): Promise<void> => {
            expect(await registry.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
        })

        it('addStream - positivetest', async (): Promise<void> => {
            const signer = hardhatEthers.Wallet.createRandom()
            const { req, sign, projectIdbytes, streamIdMetatx } = await prepareAddStreamMetatx(minimalForwarder, signer, signer.privateKey)

            expect(await minimalForwarder.connect(forwarder).verify(req, sign))
                .to.be.true

            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.false
            await minimalForwarder.connect(forwarder).execute(req, sign)
            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.true
        })

        it('addStream - wrong forwarder - negativetest', async (): Promise<void> => {
            const signer = hardhatEthers.Wallet.createRandom()
            // deploy second minimal forwarder
            const factory = await getContractFactory('MinimalForwarder', forwarder)
            const wrongForwarder = await factory.deploy() as MinimalForwarder

            // check that forwarder is set
            expect(await registry.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
            expect(await registry.isTrustedForwarder(wrongForwarder.address))
                .to.be.false

            // check that metatx works with new forwarder
            const {req, sign, projectIdbytes, streamIdMetatx} = await prepareAddStreamMetatx(wrongForwarder, signer, signer.privateKey)
            expect(await wrongForwarder.verify(req, sign))
                .to.be.true

            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.false
            await wrongForwarder.execute(req, sign)

            // internal call will have failed
            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.false
        })

        it('addStream - wrong signature - negativetest', async (): Promise<void> => {
            const signer = hardhatEthers.Wallet.createRandom()
            const wrongSigner = hardhatEthers.Wallet.createRandom() // signer.privateKey would be correct
            const {req, sign} = await prepareAddStreamMetatx(minimalForwarder, signer, wrongSigner.privateKey)
            expect(await minimalForwarder.verify(req, sign))
                .to.be.false
            await expect(minimalForwarder.execute(req, sign))
                .to.be.revertedWith('MinimalForwarder: signature does not match request')
        })

        it('addStream - not enough gas in internal transaction call - negativetest', async (): Promise<void> => {
            const signer = hardhatEthers.Wallet.createRandom()
            const {req, sign, projectIdbytes, streamIdMetatx} = await prepareAddStreamMetatx(minimalForwarder, signer, signer.privateKey, '1000')
            expect(await minimalForwarder.verify(req, sign))
                .to.be.true

            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.false
            await minimalForwarder.execute(req, sign)
            // internal call will have failed
            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.false
        })

        it('reset trusted forwarder, addStream - positivetest', async (): Promise<void> => {
            const signer = hardhatEthers.Wallet.createRandom()
            const trustedForwarderRole = await registry.TRUSTED_FORWARDER_ROLE()
            // remove previous forwarder
            expect(await registry.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
            await registry.revokeRole(trustedForwarderRole, minimalForwarder.address)
            expect(await registry.isTrustedForwarder(minimalForwarder.address))
                .to.be.false

            // check that metatx does NOT work with old forwarder
            const {
                req: reqOld,
                sign: signOld,
                projectIdbytes:projectIdOld,
                streamIdMetatx: streamIdOld
            } = await prepareAddStreamMetatx(minimalForwarder, signer, signer.privateKey)

            expect(await minimalForwarder.verify(reqOld, signOld))
                .to.be.true

            expect(await registry.isStreamAdded(projectIdOld, streamIdOld))
                .to.be.false // forwarder can verify
            await minimalForwarder.execute(reqOld, signOld) // but internal call will have failed for old forwarder
            expect(await registry.isStreamAdded(projectIdOld, streamIdOld))
                .to.be.false

            // deploy second minimal forwarder
            const factory = await getContractFactory('MinimalForwarder', forwarder)
            const newForwarder = await factory.deploy() as MinimalForwarder

            // set the new forwarder
            expect(await registry.isTrustedForwarder(newForwarder.address))
                .to.be.false
            await registry.grantRole(trustedForwarderRole, newForwarder.address)
            expect(await registry.isTrustedForwarder(newForwarder.address))
                .to.be.true

            // check that metatx works with new forwarder
            const {req, sign, projectIdbytes, streamIdMetatx} = await prepareAddStreamMetatx(newForwarder, signer, signer.privateKey)

            expect(await newForwarder.verify(req, sign))
                .to.be.true

            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.false
            await newForwarder.execute(req, sign)
            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.true
        })
    })

    describe('Trusted Role', (): void => {
        it('getTrustedRole - returns TRUSTED_ROLE', async (): Promise<void> => {
            expect(await registry.getTrustedRole())
                .to.equal(await registry.TRUSTED_ROLE())
        })

        it('grantRole - positivetest', async (): Promise<void> => {
            await registry.grantRole(await registry.TRUSTED_ROLE(), admin.address)
            expect(await registry.hasRole(await registry.TRUSTED_ROLE(), admin.address))
                .to.be.true
        })

        it('grantRole - negativetest', async (): Promise<void> => {
            await expect(registry.connect(user1).grantRole(await registry.TRUSTED_ROLE(), user1.address))
                .to.be.revertedWith('AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing '
                + 'role 0x0000000000000000000000000000000000000000000000000000000000000000')
        })

        it('revokeRole - positivetest', async (): Promise<void> => {
            await registry.revokeRole(await registry.TRUSTED_ROLE(), admin.address)
            expect(await registry.hasRole(await registry.TRUSTED_ROLE(), admin.address))
                .to.be.false
        })

        it('revokeRole - negativetest', async (): Promise<void> => {
            await expect(registry.connect(user1).revokeRole(await registry.TRUSTED_ROLE(), user1.address))
                .to.be.revertedWith('AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing '
                + 'role 0x0000000000000000000000000000000000000000000000000000000000000000')
        })

        it('deleteProject, updateProject - negativetest - does not have special privileges', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-trusted-manage-project'), 32))
            // admin creates a project, trusted can NOT control the project
            await registry.createProject(id, domainIds, paymentDetailsDefault, [], 1, true, metadata)
            await expect(registry.connect(trusted).deleteProject(id))
                .to.be.revertedWith('error_noDeletePermission')

            await expect(registry.connect(trusted)
                .updateProject(id, domainIds, paymentDetailsDefault, [], 2, 'metadata-2'))
                .to.be.revertedWith('error_noEditPermission')
        })

        it('trustedCreateProject - positivetest - public purchable', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('trusted-create-public'), 32))

            await expect(registry.connect(trusted)
                .trustedCreateProject(id, domainIds, paymentDetailsDefault, [], 1, user1.address, true, metadata))
                .to.emit(registry, "ProjectCreated")
                .to.emit(registry, 'PermissionUpdated')
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(id, ethersConstants.AddressZero, true, true, true, true) // Buy permission is added for the zero address

            // the user1 for which the project was created can update the project
            await expect(registry.connect(user1)
                .updateProject(id, domainIds, paymentDetailsDefault, [], 2, metadata))
                .to.emit(registry, "ProjectUpdated")

            const projectUpdated = await registry.getProject(id, domainIds)
            const minimumSubscriptionSeconds = projectUpdated[1]
            expect(minimumSubscriptionSeconds).to.equal(2)

            // the project is public and can be purchased by others (isPublicPurchase = true)
            expect(await registry.canBuyProject(id, user2.address))
                .to.be.true
        })

        it('trustedCreateProject - positivetest - NON public purchable', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('trusted-create-non-public'), 32))

            await expect(registry.connect(trusted)
                .trustedCreateProject(id, domainIds, paymentDetailsDefault, [], 1, user1.address, false, metadata))
                .to.emit(registry, "ProjectCreated")
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(id, user1.address, true, true, true, true)

            // the user1 for which the project was created can update the project
            await expect(registry.connect(user1)
                .updateProject(id, domainIds, paymentDetailsDefault, [], 2, metadata))
                .to.emit(registry, "ProjectUpdated")

            const projectUpdated = await registry.getProject(id, domainIds)
            const minimumSubscriptionSeconds = projectUpdated[1]
            expect(minimumSubscriptionSeconds).to.equal(2)

            // the project is not public and can't be purchased by others (isPublicPurchase = false)
            expect(await registry.canBuyProject(id, user2.address))
                .to.be.false
        })

        it('trustedCreateProject - negativetest', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-trusted-create-fails'), 32))
            await expect(registry.trustedCreateProject(id, domainIds, paymentDetailsDefault, [], 1, user1.address, true, metadata))
                .to.be.revertedWith('error_mustBeTrustedRole')
        })

        it('trustedSetPermissions - positivetest', async (): Promise<void> => {
            const projectIdbytes = await createProject() // admin creates a project
            const [canBuy, canDelete, canEdit, canGrant] = [true, true, true, true]
            expect(await registry.connect(trusted).trustedSetPermissions(projectIdbytes, user1.address, canBuy, canDelete, canEdit, canGrant))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, canBuy, canDelete, canEdit, canGrant)
            expect(await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([canBuy, canDelete, canEdit, canGrant])
        })

        it('trustedSetPermissions - negativetest', async (): Promise<void> => {
            const projectId = await createProject()
            await expect(registry.trustedSetPermissions(projectId, admin.address, true, true, true, true))
                .to.be.revertedWith('error_mustBeTrustedRole')
        })

        it('trustedSetPermissionsForMultipleProjects - positivetest', async (): Promise<void> => {
            const projectId1 = await createProject() // created by admin
            const projectId2 = await createProject() // created by admin

            await expect(registry.connect(trusted)
                .trustedSetPermissionsForMultipleProjects(
                    [projectId1, projectId2],
                    [user1.address, user2.address],
                    [permission1, permission2]))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectId1, user1.address, permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectId2, user2.address, permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant)

            expect(await registry.getPermission(projectId1, user1.address))
                .to.deep.equal([permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant])
            expect(await registry.getPermission(projectId2, user2.address))
                .to.deep.equal([permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant])
        })

        it('trustedSetPermissionsForMultipleProjects - negativetest - must have the trusted role', async (): Promise<void> => {
            const projectId1 = await createProject() // created by admin
            const projectId2 = await createProject() // created by admin
            await expect(registry.connect(admin)
                .trustedSetPermissionsForMultipleProjects([projectId1, projectId2], [user1.address, user2.address], [permission1, permission2]))
                .to.be.revertedWith('error_mustBeTrustedRole')
        })

        it('trustedSetPermissionsForMultipleProjects - negativetest - users[] & permissions[] must have the same length', async (): Promise<void> => {
            const projectId1 = await createProject() // created by admin
            const projectId2 = await createProject() // created by admin
            await expect(registry.connect(trusted)
                .trustedSetPermissionsForMultipleProjects([projectId1, projectId2], [user1.address, user2.address], [permission1]))
                .to.be.revertedWith('error_invalidInputArrayLengths')
        })
    })
})
