import { waffle, upgrades, ethers as hardhatEthers } from "hardhat"
import { expect, use } from "chai"
import { utils, Wallet, constants as ethersConstants } from "ethers"
import { signTypedData, SignTypedDataVersion, TypedMessage } from '@metamask/eth-sig-util'

import type { DATAv2, ProjectRegistry, StreamRegistryV3 } from "../../typechain"
import { MinimalForwarder } from "../../typechain/MinimalForwarder"

const { provider: waffleProvider } = waffle
const { id, hexlify, parseEther, toUtf8Bytes, zeroPad } = utils
const { getContractFactory } = hardhatEthers

const types = {
    EIP712Domain: [
        {
            name: 'name', type: 'string'
        },
        {
            name: 'version', type: 'string'
        },
        {
            name: 'chainId', type: 'uint256'
        },
        {
            name: 'verifyingContract', type: 'address'
        },
    ],
    ForwardRequest: [
        {
            name: 'from', type: 'address'
        },
        {
            name: 'to', type: 'address'
        },
        {
            name: 'value', type: 'uint256'
        },
        {
            name: 'gas', type: 'uint256'
        },
        {
            name: 'nonce', type: 'uint256'
        },
        {
            name: 'data', type: 'bytes'
        },
    ],
}

enum StreamRegistryPermissionType { Edit, Delete, Publish, Subscribe, Grant }
enum ProjectRegistryPermissionType { Buy, Delete, Edit, Grant }

use(waffle.solidity)

describe('ProjectRegistry', (): void => {
    const [admin, user1, user2, user3, beneficiary, trusted, forwarder] = waffleProvider.getWallets()
    const projectIdbytes = hexlify(zeroPad(toUtf8Bytes("testproject"), 32))
    const projectIdbytes1 = hexlify(zeroPad(toUtf8Bytes("testproject1"), 32))
    const projectIdbytesNonExistent = hexlify(zeroPad(toUtf8Bytes('notexistentproject'), 32))
    let streamId: string
    let streamId1: string
    const metadata = 'testmetadata'
    
    enum permissionType { Buy, Delete, Edit, Grant }
    const permission1 = {canBuy: true, canDelete: true, canEdit: true, canGrant: true}
    const permission2 = {canBuy: true, canDelete: true, canEdit: true, canGrant: true}

    let registry: ProjectRegistry
    let minimalForwarder: MinimalForwarder
    let streamRegistry: StreamRegistryV3
    let token: DATAv2

    before(async (): Promise<void> => {
        await deployERC20()
        await deployMinimalForwarder()
        await deployStreamRegistryAndCreateStreams()
        await deployProjectRegistry()
    })

    async function deployERC20(): Promise<void> {
        const tokenFactory = await getContractFactory("DATAv2", admin)
        token = await tokenFactory.deploy() as DATAv2
        await token.grantRole(id("MINTER_ROLE"), admin.address)
        await token.mint(admin.address, parseEther("1000"))
        // await token.mint(other.address, parseEther("1000"))
    }

    async function deployMinimalForwarder(): Promise<void> {
        const factory = await getContractFactory('MinimalForwarder', forwarder)
        minimalForwarder = await factory.deploy() as MinimalForwarder
    }

    async function deployStreamRegistryAndCreateStreams(): Promise<void> {
        const contractFactory = await getContractFactory("StreamRegistryV3", admin)
        const contractFactoryTx = await upgrades.deployProxy(
            contractFactory,
            ["0x0000000000000000000000000000000000000000", minimalForwarder.address],
            { kind: 'uups' })
        streamRegistry = await contractFactoryTx.deployed() as StreamRegistryV3

        // create streams using the StreamRegistry contract (will give admin all permisisons to the stream)
        const streamPath = '/streampath'
        const streamMetadata = 'streamMetadata'
        await streamRegistry.createStream(streamPath, streamMetadata)
        streamId = admin.address.toLowerCase() + streamPath

        const streamPath1 = '/streampath1'
        const streamMetadata1 = 'streammetadata1'
        await streamRegistry.createStream(streamPath1, streamMetadata1)
        streamId1 = admin.address.toLowerCase() + streamPath1
    }

    async function deployProjectRegistry(): Promise<void> {
        const contractFactory = await getContractFactory("ProjectRegistry", admin)
        const contractFactoryTx = await upgrades.deployProxy(contractFactory, [streamRegistry.address], { kind: 'uups' })
        registry = await contractFactoryTx.deployed() as ProjectRegistry

        const trustedRole = await registry.getTrustedRole()
        await registry.grantRole(trustedRole, trusted.address)

        const trustedForwarderRole = await registry.TRUSTED_FORWARDER_ROLE()
        await registry.grantRole(trustedForwarderRole, minimalForwarder.address)
    }

    async function enableGrantPermissionForStream(streamId: string): Promise<void> {
        // enable Grant subscription for stream to project registry
        // the user adding a stream to project needs Edit permision on the project and Grant permission on the stream
        // by having Grant permission on the stream, project registry can update the stream permissions (e.g. enable Subscribe for streams on buy)
        await streamRegistry.grantPermission(streamId, registry.address, StreamRegistryPermissionType.Grant)
    }
    
    describe('Project management', (): void => {
        it("createProject - positivetest - creates a project with correct params", async () => {
            const projectBeneficiary = beneficiary.address
            const projectPricePerSecond = 1
            const projectCurrency = token.address
            const minimumSubscriptionSeconds = 1
            const isPublicPurchable = false

            await expect(await registry.createProject(
                projectIdbytes,
                projectBeneficiary,
                projectPricePerSecond,
                projectCurrency,
                minimumSubscriptionSeconds,
                isPublicPurchable,
                metadata))
                .to.emit(registry, "ProjectCreated")
                .withArgs(
                    projectIdbytes,
                    projectBeneficiary,
                    projectPricePerSecond,
                    projectCurrency,
                    minimumSubscriptionSeconds,
                    metadata,
                )
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, admin.address, true, true, true, true)

            const res = await registry.getProject(projectIdbytes)
            const actual = String([
                res[0],
                res[1].toNumber(),
                res[2],
                res[3].toNumber(), 
                res[4],
            ])
            const expected = String([
                projectBeneficiary,
                projectPricePerSecond,
                projectCurrency,
                minimumSubscriptionSeconds,
                metadata
            ])
            expect(actual).to.equal(expected)

            // create a second project (same params except for project id)
            await expect(await registry.createProject(
                projectIdbytes1,
                projectBeneficiary,
                projectPricePerSecond,
                projectCurrency,
                minimumSubscriptionSeconds,
                isPublicPurchable,
                metadata))
                .to.emit(registry, "ProjectCreated")
                .withArgs(
                    projectIdbytes1,
                    projectBeneficiary,
                    projectPricePerSecond,
                    projectCurrency,
                    minimumSubscriptionSeconds,
                    metadata,
                )
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes1, admin.address, true, true, true, true)
        })

        it("createProject - negativetest - fails for empty project ID", async () => {
            const productIdEmptyString = hexlify(zeroPad(toUtf8Bytes(''), 32))
            await expect(registry.createProject(productIdEmptyString, beneficiary.address, 1, token.address, 1, true, "meta"))
                .to.be.revertedWith('error_nullProjectId')
        })

        it("createProject - positivetest - can create free projects", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-create-free'), 32))
            // free projects are supported on project creation
            expect(await registry.createProject(id, beneficiary.address, 0, token.address, 1, true, metadata))
                .to.emit(registry, "ProjectCreated")
                .withArgs(admin.address, id, beneficiary.address, 0, token.address, 1, metadata)
        })

        it("updateProject - positivetest - can update to free projects", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-update-free'), 32))
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)
            // free projects are supported on project update
            expect(await registry.updateProject(id, beneficiary.address, 0, token.address, 2, metadata))
                .to.emit(registry, "ProjectUpdated")
                .withArgs(id, beneficiary.address, 0, token.address, 2, metadata)
        })

        it("createProject - negativetest - fails for existing projects", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-double-create'), 32))
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)
            await expect(registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata))
                .to.be.revertedWith('error_alreadyExists')
        })

        it("canBuyProject - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-can-buy-project'), 32))
            const isPublicPurchable = true
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, isPublicPurchable, metadata)
            expect(await registry.canBuyProject(id, user1.address))
                .to.be.true
        })

        it("canBuyProject - negativetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-cant-buy-project'), 32))
            const isPublicPurchable = false
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, isPublicPurchable, metadata)
            expect(await registry.canBuyProject(id, user1.address))
                .to.be.false
        })

        it("deleteProject, updateProject - negativetest - can only be modified if user has delete/edit permission", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-owner'), 32))
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)
            await expect(registry.connect(user1).deleteProject(id))
                .to.be.revertedWith("error_noDeletePermission")
            await expect(registry.connect(user1).updateProject(id, beneficiary.address, 2, token.address, 2, metadata))
                .to.be.revertedWith("error_noEditPermission")
        })

        it("deleteProject - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-delete'), 32))
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)

            expect((await registry.getProject(id)).version)
                .to.equal(1)

            await expect(registry.deleteProject(id))
                .to.emit(registry, "ProjectDeleted")
                .withArgs(id)
            expect((await registry.getProject(id)).version)
                .to.equal(0)
        })

        it("deleteProject - negativetest - no Delete permission", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-delete-fails'), 32))
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)
            await expect(registry.connect(user1).deleteProject(id))
                .to.be.revertedWith("error_noDeletePermission")
        })

        it("updateProject - positivetest", async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-update'), 32))
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)
            await expect(registry.updateProject(id, beneficiary.address, 2, token.address, 2, metadata))
                .to.emit(registry, "ProjectUpdated")
                .withArgs(id, beneficiary.address, 2, token.address, 2, metadata)
        })

        it("updateProject - negativetest - throws for non existing projects", async () => {
            await expect(registry
                .updateProject(projectIdbytesNonExistent, beneficiary.address, 2, token.address, 2, metadata))
                .to.be.revertedWith('error_noEditPermission')
        })
    })

    describe('Streams', (): void => {
        it('addStream - adds stream and updates permissions', async (): Promise<void> => {
            await enableGrantPermissionForStream(streamId)

            expect(await registry.addStream(projectIdbytes, streamId))
                .to.emit(registry, 'StreamAdded')
                .withArgs(projectIdbytes, streamId)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, admin.address, true, true, true, true)
            expect(await registry.getPermission(projectIdbytes, admin.address))
                .to.deep.equal([true, true, true, true])
        })

        it('addStream - negativetest - fails without Grant permission for stream', async (): Promise<void> => {
            // admin creates project => admin has project permissions
            const id = hexlify(zeroPad(toUtf8Bytes('add-stream-no-perm'), 32))
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)

            // admin creates stream => admin has stream permissions
            await streamRegistry.createStream('/streampathadd', metadata)
            const streamid = admin.address.toLowerCase() + '/streampathadd'

            // grant Edit permission on project to user1
            await registry.enablePermissionType(id, user1.address, ProjectRegistryPermissionType.Edit)

            // user1 does NOT have permissions on stream
            await expect(registry.connect(user1).addStream(id, streamid))
                .to.be.revertedWith('error_noGrantPermissionForStream')
        })

        it('addStream - negativetest - fails if stream was already added', async (): Promise<void> => {
            await expect(registry.addStream(projectIdbytes, streamId))
                .to.be.revertedWith('error_streamAlreadyAdded')
        })
    
        it('removeStream - removes stream from project', async (): Promise<void> => {
            expect(await registry.isStreamAdded(projectIdbytes, streamId1))
                .to.be.false

            await enableGrantPermissionForStream(streamId1)

            await registry.addStream(projectIdbytes, streamId1)
            expect(await registry.isStreamAdded(projectIdbytes, streamId1))
                .to.be.true
            expect(await registry.removeStream(projectIdbytes, streamId1))
                .to.emit(registry, 'StreamRemoved')
                .withArgs(projectIdbytes, streamId1)
            expect(await registry.isStreamAdded(projectIdbytes, streamId1))
                .to.be.false
        })
    })

    describe('Subscription management', () => {
        it('getSubscription - positivetest', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-get-subscription'), 32))
            const pricePerSecond = 1
            await registry.createProject(id, beneficiary.address, pricePerSecond, token.address, 1, true, metadata)
            
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

        it('getSubscription - negativetest', async () => {
            await expect(registry.getSubscription(projectIdbytesNonExistent, admin.address))
                .to.be.revertedWith('error_notFound')
        })

        it('grantSubscription - positivetest', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-grant-subscription'), 32))
            const pricePerSecond = 1
            await registry.createProject(id, beneficiary.address, pricePerSecond, token.address, 1, true, metadata)
            expect(await registry.addStream(id, streamId))
                .to.emit(registry, 'StreamAdded')
                .withArgs(id, streamId)

            // reset subscription to block.timestamp + 1
            await registry.grantSubscription(id, 1, user1.address)

            const subscriptionBefore = await registry.getSubscription(id, user1.address)
            const addSeconds = 100
            await expect(registry.grantSubscription(id, addSeconds, user1.address))
                .to.emit(registry, "Subscribed")
                .withArgs(id, user1.address, addSeconds / pricePerSecond)
                .to.emit(streamRegistry, "PermissionUpdated")
            const subscriptionAfter = await registry.getSubscription(id, user1.address)
            expect(subscriptionAfter.endTimestamp)
                .to.equal(subscriptionBefore.endTimestamp.add(addSeconds / pricePerSecond))
            
        })

        it('grantSubscription - negativetest - must have Grant permission', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-grant-sub-permisson'), 32))
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)
            await expect(registry.connect(user1).grantSubscription(projectIdbytes, 100, user1.address))
                .to.be.revertedWith("error_noGrantPermission")
        })

        it('grantSubscription - negativetest - must extend by greater than zero seconds', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-grant-sub-seconds'), 32))
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)
            await registry.grantSubscription(id, 100, admin.address) // reset sub endTimestamp to block.timestamp + 100
            await expect(registry.grantSubscription(id, 0, admin.address))
                .to.be.revertedWith("error_topUpTooSmall")
        })
    })

    describe('Permissions', (): void => {
        it('getPermission - returns user permissions', async (): Promise<void> => {
            expect(await registry.getPermission(projectIdbytes, admin.address))
                .to.deep.equal([true, true, true, true])
        })

        it('getPermission - reverts if project does not exist', async (): Promise<void> => {
            await expect(registry.getPermission(projectIdbytesNonExistent, admin.address))
                .to.be.revertedWith('error_projectDoesNotExist')
        })

        it('setPermissionBooleans - reverts is user does not have grant permission', async (): Promise<void> => {
            await expect(registry.connect(user2).setPermissionBooleans(projectIdbytes, admin.address, true, true, true, true))
                .to.be.revertedWith('error_noGrantPermission')
        })

        it('setPermissionBooleans', async (): Promise<void> => {
            const projectIdbytes = hexlify(zeroPad(toUtf8Bytes('test-set-perm'), 32))
            await registry.createProject(projectIdbytes, beneficiary.address, 1, token.address, 1, true, metadata)

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

        it('setPermissionsForMultipleUsers - positivetest', async (): Promise<void> => {
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

        it('setPermissionsForMultipleUsers - negativetest', async (): Promise<void> => {
            await expect(registry.setPermissionsForMultipleUsers(
                projectIdbytes,
                [user1.address],
                [permission1, permission2]))
                .to.be.revertedWith('error_invalidUserPermissionArrayLengths')
        })

        it('setPermissionsForMultipleProjects - positivetest', async (): Promise<void> => {
            await registry.setPermissionBooleans(projectIdbytes, user1.address, false, false, false, false)
            await registry.setPermissionBooleans(projectIdbytes, user2.address, false, false, false, false)
            await registry.setPermissionBooleans(projectIdbytes1, user1.address, false, false, false, false)
            await registry.setPermissionBooleans(projectIdbytes1, user2.address, false, false, false, false)

            await expect(registry.setPermissionsForMultipleProjects(
                [projectIdbytes, projectIdbytes1],
                [[user1.address, user2.address], [user1.address, user2.address]],
                [[permission1, permission2], [permission1, permission2]]))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user2.address, permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes1, user1.address, permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes1, user2.address, permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant)
        })

        it('setPermissionsForMultipleProjects - negativetest', async (): Promise<void> => {
            await expect(registry.setPermissionsForMultipleProjects(
                [projectIdbytes],
                [[user1.address, user2.address], [user1.address, user2.address]],
                [[permission1, permission2], [permission1, permission2]]))
                .to.be.revertedWith('error_invalidProjectUserPermissionArrayLengths')
        })

        it('transferAllPermissionsToUser - positivetest', async (): Promise<void> => {
            // user1 has all permissions
            await registry.setPermissionBooleans(projectIdbytes, user1.address, true, true, true, true)
            expect (await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([true, true, true, true])
            // user1 has no permissions
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
            await expect(registry.connect(user1).transferAllPermissionsToUser(projectIdbytes, user2.address))
                .to.be.revertedWith('error_noPermissionToTransfer')
        })

        it('transferPermissionType - positivetest', async (): Promise<void> => {
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
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Buy))
                .to.be.revertedWith('error_noPermissionToTransfer')
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Delete))
                .to.be.revertedWith('error_noPermissionToTransfer')
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Edit))
                .to.be.revertedWith('error_noPermissionToTransfer')
            await expect(registry.connect(user3).transferPermissionType(projectIdbytes, user2.address, permissionType.Grant))
                .to.be.revertedWith('error_noPermissionToTransfer')
        })

        it('revokePermissionType - positivetest', async (): Promise<void> => {
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

        it('revokeAllPermissionsForUser - positivetest', async (): Promise<void> => {
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

        it('revokeAllPermissionsForUser - negativetest', async (): Promise<void> => {
            // set Grant permission to false for user3 on projectIdbytes
            await registry.setPermissionBooleans(projectIdbytes, user3.address, true, true, true, false)
            expect (await registry.hasPermissionType(projectIdbytes, user3.address, permissionType.Grant))
                .to.be.false
            
            await expect(registry.connect(user3).revokeAllPermissionsForUser(projectIdbytes, user3.address))
                .to.be.revertedWith('error_noGrantPermission')
        })
    })

    describe('Metatransactions', (): void => {
        async function prepareAddStreamMetatx(minimalForwarder: MinimalForwarder, signKey: string, gas = '1000000') {
            const streamPathMetatx = '/streampathmetatx' + Wallet.createRandom().address
            const streamMetadataMetatx = 'streamMetadataMetatx' + Wallet.createRandom().address
            await streamRegistry.createStream(streamPathMetatx, streamMetadataMetatx)
            const streamIdMetatx = admin.address.toLowerCase() + streamPathMetatx

            // admin is creating and signing transaction, forwarder is posting it and paying for gas
            const data = registry.interface.encodeFunctionData('addStream', [projectIdbytes, streamIdMetatx])
            const req = {
                from: admin.address,
                to: registry.address,
                value: '0',
                gas,
                nonce: (await minimalForwarder.getNonce(admin.address)).toString(),
                data
            }
            const d: TypedMessage<any> = {
                types,
                domain: {
                    name: 'MinimalForwarder',
                    version: '0.0.1',
                    chainId: (await waffleProvider.getNetwork()).chainId,
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
            const sign = signTypedData(options) // forwarder
            return {req, sign, projectIdbytes, streamIdMetatx}
        }
        
        it('isTrustedForwarder - positivetest', async (): Promise<void> => {
            expect(await registry.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
        })

        it('addStream - positivetest', async (): Promise<void> => {
            const {req, sign, projectIdbytes, streamIdMetatx} = await prepareAddStreamMetatx(minimalForwarder.connect(forwarder), admin.privateKey)
            expect(await minimalForwarder.connect(forwarder).verify(req, sign))
                .to.be.true

            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.false

            await enableGrantPermissionForStream(streamIdMetatx)
            
            await minimalForwarder.connect(forwarder).execute(req, sign)
            expect(await registry.isStreamAdded(projectIdbytes, streamIdMetatx))
                .to.be.true
        })

        it('addStream - wrong forwarder - negativetest', async (): Promise<void> => {
            // deploy second minimal forwarder
            const factory = await getContractFactory('MinimalForwarder', forwarder)
            const wrongForwarder = await factory.deploy() as MinimalForwarder

            // check that forwarder is set
            expect(await registry.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
            expect(await registry.isTrustedForwarder(wrongForwarder.address))
                .to.be.false

            // check that metatx works with new forwarder
            const {req, sign, projectIdbytes, streamIdMetatx} = await prepareAddStreamMetatx(wrongForwarder, admin.privateKey)
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
            const wrongKey = user1.privateKey // admin.privateKey would be correct
            const {req, sign} = await prepareAddStreamMetatx(minimalForwarder, wrongKey)
            expect(await minimalForwarder.verify(req, sign))
                .to.be.false
            await expect(minimalForwarder.execute(req, sign))
                .to.be.revertedWith('MinimalForwarder: signature does not match request')
        })

        it('addStream - not enough gas in internal transaction call - negativetest', async (): Promise<void> => {
            const {req, sign, projectIdbytes, streamIdMetatx} = await prepareAddStreamMetatx(minimalForwarder, admin.privateKey, '1000')
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
            } = await prepareAddStreamMetatx(minimalForwarder, admin.privateKey)

            await enableGrantPermissionForStream(streamIdOld)
            
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
            const {req, sign, projectIdbytes, streamIdMetatx} = await prepareAddStreamMetatx(newForwarder, admin.privateKey)

            await enableGrantPermissionForStream(streamIdMetatx)
            
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
                .to.be.revertedWith('account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing '
                + 'role 0x0000000000000000000000000000000000000000000000000000000000000000')
        })

        it('revokeRole - positivetest', async (): Promise<void> => {
            await registry.revokeRole(await registry.TRUSTED_ROLE(), admin.address)
            expect(await registry.hasRole(await registry.TRUSTED_ROLE(), admin.address))
                .to.be.false
        })

        it('revokeRole - negativetest', async (): Promise<void> => {
            await expect(registry.connect(user1).revokeRole(await registry.TRUSTED_ROLE(), user1.address))
                .to.be.revertedWith('account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing '
                + 'role 0x0000000000000000000000000000000000000000000000000000000000000000')
        })

        it('deleteProject, updateProject - negativetest - does not have special privileges', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-trusted-manage-project'), 32))
            // admin creates a project, trusted can NOT control the project
            await registry.createProject(id, beneficiary.address, 1, token.address, 1, true, metadata)
            await expect(registry.connect(trusted).deleteProject(id))
                .to.be.revertedWith('error_noDeletePermission')
        
            await expect(registry.connect(trusted)
                .updateProject(id, beneficiary.address, 2, token.address, 1, metadata))
                .to.be.revertedWith('error_noEditPermission')
        })

        it('trustedCreateProject - positivetest - public purchable', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('trusted-create-public'), 32))

            await expect(registry.connect(trusted)
                .trustedCreateProject(id, beneficiary.address, 1, token.address, 1, user1.address, true, metadata))
                .to.emit(registry, "ProjectCreated")
                .withArgs(id, beneficiary.address, 1, token.address, 1, metadata)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(id, user1.address, true, true, true, true)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(id, ethersConstants.AddressZero, true, true, true, true) // Buy permission is added for the zero address

            // the user1 for which the project was created can update the project
            await expect(registry.connect(user1)
                .updateProject(id, beneficiary.address, 2, token.address, 2, metadata))
                .to.emit(registry, "ProjectUpdated")
                .withArgs(id, beneficiary.address, 2, token.address, 2, metadata)

            // project state was set to Deployed and the project can be purchased (is public)
            expect(await registry.canBuyProject(id, user2.address))
                .to.be.true
        })

        it('trustedCreateProject - positivetest - NON public purchable', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('trusted-create-non-public'), 32))

            await expect(registry.connect(trusted)
                .trustedCreateProject(id, beneficiary.address, 1, token.address, 1, user1.address, false, metadata))
                .to.emit(registry, "ProjectCreated")
                .withArgs(id, beneficiary.address, 1, token.address, 1, metadata)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(id, user1.address, true, true, true, true)

            // the user1 for which the project was created can update the project
            await expect(registry.connect(user1)
                .updateProject(id, beneficiary.address, 2, token.address, 2, metadata))
                .to.emit(registry, "ProjectUpdated")
                .withArgs(id, beneficiary.address, 2, token.address, 2, metadata)

            // project state was set to Deployed but the project can not be purchased by others (not public)
            expect(await registry.canBuyProject(id, user2.address))
                .to.be.false
        })

        it('trustedCreateProject - negativetest', async () => {
            const id = hexlify(zeroPad(toUtf8Bytes('test-trusted-create-fails'), 32))
            await expect(registry.trustedCreateProject(id, beneficiary.address, 1, token.address, 1, user1.address, true, metadata))
                .to.be.revertedWith('error_mustBeTrustedRole')
        })
    
        it('trustedSetPermissions - positivetest', async (): Promise<void> => {
            const [canBuy, canDelete, canEdit, canGrant] = [true, true, true, true]
            expect(await registry.connect(trusted).trustedSetPermissions(projectIdbytes, user1.address, canBuy, canDelete, canEdit, canGrant))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, canBuy, canDelete, canEdit, canGrant)
            expect(await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([canBuy, canDelete, canEdit, canGrant])
        })
    
        it('trustedSetPermissions - negativetest', async (): Promise<void> => {
            await expect(registry.trustedSetPermissions(projectIdbytes, admin.address, true, true, true, true))
                .to.be.revertedWith('error_mustBeTrustedRole')
        })
    
        it('trustedSetPermissionsForMultipleProjects - positivetest', async (): Promise<void> => {
            expect(await registry.connect(trusted)
                .trustedSetPermissionsForMultipleProjects(
                    [projectIdbytes, projectIdbytes1],
                    [user1.address, user2.address],
                    [permission1, permission2]))
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes, user1.address, permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant)
                .to.emit(registry, 'PermissionUpdated')
                .withArgs(projectIdbytes1, user2.address, permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant)
            
            expect(await registry.getPermission(projectIdbytes, user1.address))
                .to.deep.equal([permission1.canBuy, permission1.canDelete, permission1.canEdit, permission1.canGrant])
            expect(await registry.getPermission(projectIdbytes1, user2.address))
                .to.deep.equal([permission2.canBuy, permission2.canDelete, permission2.canEdit, permission2.canGrant])
        })

        it('trustedSetPermissionsForMultipleProjects - negativetest - users[] & permissions[] must have the same length', async (): Promise<void> => {
            await expect(registry.connect(trusted)
                .trustedSetPermissionsForMultipleProjects([projectIdbytes, projectIdbytes1], [user1.address, user2.address], [permission1]))
                .to.be.revertedWith('error_invalidInputArrayLengths')
        })
    })
})
