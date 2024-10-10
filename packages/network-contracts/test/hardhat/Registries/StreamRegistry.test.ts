import { upgrades, ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import Debug from "debug"

import { Wallet } from "@ethersproject/wallet"

import { getEIP2771MetaTx } from "./getEIP2771MetaTx"
import type { MinimalForwarder } from "../../../typechain"
import type { StreamRegistry } from "../../../src/exports"

import type { StreamRegistryV2, StreamRegistryV3, StreamRegistryV4 } from "../../../typechain"
import { randomBytes } from 'crypto'
import { Signer } from 'ethers'
import { parseEther } from '@ethersproject/units'

// eslint-disable-next-line no-unused-vars
enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Share }

const log = Debug("Streamr::test::StreamRegistry")

const {
    BigNumber,
    constants: { AddressZero, Zero, MaxUint256 }
} = hardhatEthers

const NO_PERMISSIONS_STRUCT: StreamRegistry.PermissionStruct = {
    canEdit: false,
    canDelete: false,
    publishExpiration: Zero,
    subscribeExpiration: Zero,
    canGrant: false,
}
const ALL_PERMISSIONS_STRUCT: StreamRegistry.PermissionStruct = {
    canEdit: true,
    canDelete: true,
    publishExpiration: MaxUint256,
    subscribeExpiration: MaxUint256,
    canGrant: true,
}
const PUB_SUB_ONLY_PERMISSIONS_STRUCT: StreamRegistry.PermissionStruct = {
    canEdit: false,
    canDelete: false,
    publishExpiration: MaxUint256,
    subscribeExpiration: MaxUint256,
    canGrant: false,
}

const METADATA = JSON.stringify({ foo: 'bar' })
const METADATA_0 = "streammetadata0"
const METADATA_1 = "streammetadata1"
const USER_ID = "0x" + Array(64).join("0123456789abcdef") // repeat string X times

const getBlocktime = async (): Promise<number> => {
    const block = await hardhatEthers.provider.getBlock("latest")
    return block.timestamp
}

const getStreamId = async (owner: { getAddress: () => Promise<string> }, path: string): Promise<string> => {
    return `${(await owner.getAddress()).toLowerCase()}${path}`
}

const getStreamPath = (streamId: string) => {
    const pos = streamId.indexOf('/')
    return streamId.substring(pos)
}

const randomStreamPath = (): string => {
    return `/${randomBytes(10).toString('hex')}`
}

const randomUser = async (): Promise<Wallet> => {
    const user = Wallet.createRandom().connect(hardhatEthers.provider)
    // send some token so that the user can execute transactions
    const admin = await getAdmin()
    await admin.sendTransaction({ to: user.address, value: parseEther('10000') })
    return user
}

const randomAddress = (): string => {
    return Wallet.createRandom().address
}

const getAdmin = async (): Promise<Signer> => {
    return (await hardhatEthers.getSigners())[0]
}

describe("StreamRegistry", async (): Promise<void> => {

    let registry: StreamRegistry
    let streamId: string
    let user: Signer
    // for upgrade test
    let initialStream1: string
    let initialStream2: string
    let initialOtherUser: Signer
    // for meta-transaction test
    let forwarderUser: Signer
    let minimalForwarder: MinimalForwarder
    // for ENS test
    let trustedUser: Signer
    
    before(async (): Promise<void> => {
        user = await randomUser()
        initialStream1 = await getStreamId(user, randomStreamPath())
        initialStream2 = await getStreamId(user, randomStreamPath())
        initialOtherUser = await randomUser()
        forwarderUser = await randomUser()
        const minimalForwarderContractFactory = await hardhatEthers.getContractFactory("MinimalForwarder", forwarderUser)
        minimalForwarder = await minimalForwarderContractFactory.deploy() as MinimalForwarder
        trustedUser = await randomUser()
        
        const admin = await getAdmin()
        const streamRegistryFactoryV2 = await hardhatEthers.getContractFactory("StreamRegistryV2", admin)
        const streamRegistryFactoryV2Tx = await upgrades.deployProxy(streamRegistryFactoryV2, [
            AddressZero,
            minimalForwarder.address
        ], { kind: "uups" })
        const registryV2 = (await streamRegistryFactoryV2Tx.deployed()).connect(user) as StreamRegistryV2

        await (await registryV2.createStream(getStreamPath(initialStream1), METADATA_0)).wait()
        await (await registryV2.grantPermission(initialStream1, await initialOtherUser.getAddress(), PermissionType.Edit)).wait()

        // to upgrade the deployer must also have the trusted role, so
        //   we will grant it and revoke it after the upgrade to keep admin and trusted roles separate
        // go through the upgrade path here in the test setup; then all the tests will be run on an "upgraded" contract,
        //   which better mimics the situation of the production deployment
        await registryV2.connect(admin).grantRole(await registryV2.TRUSTED_ROLE(), await admin.getAddress())
        const streamregistryFactoryV3 = await hardhatEthers.getContractFactory("StreamRegistryV3", admin)
        const streamRegistryFactoryV3Tx = await upgrades.upgradeProxy(streamRegistryFactoryV2Tx.address, streamregistryFactoryV3)
        const registryV3 = (await streamRegistryFactoryV3Tx.deployed()).connect(user) as StreamRegistryV3

        await (await registryV3.createStream(getStreamPath(initialStream2), METADATA_1)).wait()
        await (await registryV3.setExpirationTime(initialStream2, await initialOtherUser.getAddress(), PermissionType.Publish, 1000000)).wait()

        const streamregistryFactoryV4 = await hardhatEthers.getContractFactory("StreamRegistryV4", admin)
        const streamRegistryFactoryV4Tx = await upgrades.upgradeProxy(streamRegistryFactoryV2Tx.address, streamregistryFactoryV4)
        const registryV4 = (await streamRegistryFactoryV4Tx.deployed()).connect(user) as StreamRegistryV4

        await (await registryV4.setExpirationTime(initialStream2, await initialOtherUser.getAddress(), PermissionType.Subscribe, 2000000)).wait()

        const streamRegistryFactory = await hardhatEthers.getContractFactory("StreamRegistryV5", admin)
        const streamRegistryDeployTx = await upgrades.upgradeProxy(streamRegistryFactoryV3Tx.address, streamRegistryFactory)
        registry = (await streamRegistryDeployTx.deployed()).connect(user) as StreamRegistry
        await registry.connect(admin).revokeRole(await registry.TRUSTED_ROLE(), await admin.getAddress())
        // eslint-disable-next-line require-atomic-updates

        // cover also `initialize` of the newest version
        await upgrades.deployProxy(streamRegistryFactory, [
            AddressZero,
            minimalForwarder.address
        ], { kind: "uups" })

        await registry.connect(admin).grantRole(await registry.TRUSTED_ROLE(), await trustedUser.getAddress())
    })

    beforeEach(async () => {
        streamId = await createStream()
    })

    async function createStream(): Promise<string> {
        const streamPath = randomStreamPath() 
        const streamId = await getStreamId(user, streamPath)
        await (await registry.createStream(streamPath, METADATA)).wait()
        return streamId
    }

    describe("After upgrading", () => {
        it("successfully gets V2 stream and permission", async () => {
            expect(await registry.getStreamMetadata(initialStream1)).to.equal(METADATA_0)
            expect(await registry.getPermissionsForUser(initialStream1, await initialOtherUser.getAddress())).to.deep.equal([true, false, 0, 0, false])
        })

        it("successfully gets V3 stream and permission", async () => {
            expect(await registry.getStreamMetadata(initialStream2)).to.equal(METADATA_1)
            expect(await registry.getPermissionsForUser(initialStream2, await initialOtherUser.getAddress())).to.deep.equal([false, false, 1000000, 2000000, false])
        })
    })

    describe("Stream creation", () => {
        it("works using createStream", async (): Promise<void> => {
            const newStreamPath = randomStreamPath()
            const newStreamId = await getStreamId(user, newStreamPath)
            await expect(await registry.createStream(newStreamPath, METADATA_0))
                .to.emit(registry, "StreamCreated")
                .withArgs(newStreamId, METADATA_0)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId, await user.getAddress(), true, true, MaxUint256, MaxUint256, true)
            expect(await registry.streamIdToMetadata(newStreamId)).to.equal(METADATA_0)
        })

        it("works when stream path uses only legal characters", async (): Promise<void> => {
            expect(await registry.createStream("/", METADATA_0))
                .to.not.throw
            expect(await registry.createStream("/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./_-", METADATA_0))
                .to.not.throw

            await expect(registry.createStream("/,", METADATA_0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/:", METADATA_0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/@", METADATA_0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/[", METADATA_0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/`", METADATA_0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/{", METADATA_0))
                .to.be.revertedWith("error_invalidPathChars")
        })

        it("FAILS for empty metadata", async (): Promise<void> => {
            await expect(registry.createStream("/test", ""))
                .to.be.revertedWith("error_metadataJsonStringIsEmpty")
        })

        it("FAILS if stream with that ID already exists", async (): Promise<void> => {
            await expect(registry.createStream(getStreamPath(streamId), METADATA_0))
                .to.be.revertedWith("error_streamAlreadyExists")
        })

        it("FAILS if path not start with slash", async (): Promise<void> => {
            await expect(registry.createStream("pathWithoutSlash", METADATA_0))
                .to.be.revertedWith("error_pathMustStartWithSlash")
        })

        it("works using createStreamWithPermissions", async (): Promise<void> => {
            const newStreamPath = randomStreamPath()
            const newStreamId = await getStreamId(user, newStreamPath)
            const permissionA = {
                canEdit: true,
                canDelete: false,
                publishExpiration: MaxUint256,
                subscribeExpiration: MaxUint256,
                canGrant: true
            }
            const permissionB = {
                canEdit: false,
                canDelete: false,
                publishExpiration: 7,
                subscribeExpiration: 7,
                canGrant: false
            }
            const otherUser = await randomUser()
            await expect(await registry.createStreamWithPermissions(newStreamPath, METADATA_1,
                [await user.getAddress(), await otherUser.getAddress()], [permissionA, permissionB]))
                .to.emit(registry, "StreamCreated")
                .withArgs(newStreamId, METADATA_1)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId, await user.getAddress(), true, true, MaxUint256, MaxUint256, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId, await user.getAddress(), true, false, MaxUint256, MaxUint256, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId, await otherUser.getAddress(), false, false, 7, 7, false)
            expect(await registry.getStreamMetadata(newStreamId)).to.equal(METADATA_1)
        })

        it("works using createMultipleStreamsWithPermissions", async (): Promise<void> => {
            const newStreamPath1 = randomStreamPath()
            const newStreamPath2 = randomStreamPath()
            const newStreamId1 = await getStreamId(user, newStreamPath1)
            const newStreamId2 = await getStreamId(user, newStreamPath2)
            const permissionA = {
                canEdit: true,
                canDelete: false,
                publishExpiration: MaxUint256,
                subscribeExpiration: MaxUint256,
                canGrant: true
            }
            const permissionB = {
                canEdit: false,
                canDelete: false,
                publishExpiration: 7,
                subscribeExpiration: 7,
                canGrant: false
            }
            const otherUser = await randomUser()
            await expect(await registry.createMultipleStreamsWithPermissions(
                [newStreamPath1, newStreamPath2], [METADATA_1, METADATA_1], [[await user.getAddress(), await otherUser.getAddress()],
                    [await user.getAddress(), await otherUser.getAddress()]], [[permissionA, permissionB], [permissionA, permissionB]]))
                .to.emit(registry, "StreamCreated")
                .withArgs(newStreamId1, METADATA_1)
                .to.emit(registry, "StreamCreated")
                .withArgs(newStreamId2, METADATA_1)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId1, await user.getAddress(), true, true, MaxUint256, MaxUint256, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId2, await user.getAddress(), true, true, MaxUint256, MaxUint256, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId1, await user.getAddress(), true, false, MaxUint256, MaxUint256, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId2, await user.getAddress(), true, false, MaxUint256, MaxUint256, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId1, await otherUser.getAddress(), false, false, 7, 7, false)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId2, await otherUser.getAddress(), false, false, 7, 7, false)
            expect(await registry.getStreamMetadata(newStreamId1)).to.equal(METADATA_1)
            expect(await registry.getStreamMetadata(newStreamId2)).to.equal(METADATA_1)
        })

        // test if create stream->delete stream->recreate stream with same id also wipes
        // all permissions (not trivial since you can't delete mappings)
        it("wipes permissions when you recreate stream with same ID", async (): Promise<void> => {
            const otherUser = await randomUser()
            // give other user all permissions
            await registry.setPermissionsForUser(streamId, await otherUser.getAddress(),
                true, true, MaxUint256, MaxUint256, true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, MaxUint256, MaxUint256, true])
            // delete stream, and recreate with same id
            await registry.deleteStream(streamId)
            await registry.createStream(getStreamPath(streamId), METADATA_0)
            // check that other user has no permission
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, Zero, Zero, false])
        })
    })

    describe("Stream metadata", () => {
        it("positivetest getStreamMetadata", async (): Promise<void> => {
            expect(await registry.getStreamMetadata(streamId)).to.equal(METADATA)
        })

        it("negativetest getStreamMetadata, stream doesn't exist", async (): Promise<void> => {
            await expect(registry.getStreamMetadata("0x00")).to.be.revertedWith("error_streamDoesNotExist")
        })

        it("positivetest updateStreamMetadata + event", async (): Promise<void> => {
            await expect(await registry.updateStreamMetadata(streamId, METADATA_1))
                .to.emit(registry, "StreamUpdated")
                .withArgs(streamId, METADATA_1)
            expect(await registry.getStreamMetadata(streamId)).to.equal(METADATA_1)
        })

        it("negativetest updateStreamMetadata, not exist, no right", async (): Promise<void> => {
            await expect(registry.updateStreamMetadata("0x00", METADATA_0))
                .to.be.revertedWith("error_streamDoesNotExist")
            const otherUser = await randomUser()
            await expect(registry.connect(otherUser).updateStreamMetadata(streamId, METADATA_0))
                .to.be.revertedWith("error_noEditPermission")
        })
    })

    describe("Stream deletion", () => {

        it("positivetest deleteStream + event", async (): Promise<void> => {
            await expect(await registry.deleteStream(streamId))
                .to.emit(registry, "StreamDeleted")
                .withArgs(streamId)
            await expect(registry.updateStreamMetadata(streamId, METADATA_0))
                .to.be.revertedWith("error_streamDoesNotExist")
        })

        it("FAILS if stream does not exist, or no delete permission", async (): Promise<void> => {
            await expect(registry.deleteStream("0x00"))
                .to.be.revertedWith("error_streamDoesNotExist")
            const otherUser = await randomUser()
            await expect(registry.connect(otherUser).deleteStream(streamId))
                .to.be.revertedWith("error_noDeletePermission")
        })
    })

    describe("Permissions getters", () => {

        it("positivetest getDirectPermissionForUser", async (): Promise<void> => {
            expect(await registry.getDirectPermissionsForUser(streamId, await user.getAddress()))
                .to.deep.equal([true, true, MaxUint256, MaxUint256, true])
        })

        it("positivetest getPermissionForUser", async (): Promise<void> => {
            expect(await registry.getPermissionsForUser(streamId, await user.getAddress()))
                .to.deep.equal([true, true, MaxUint256, MaxUint256, true])
        })

        it("getPermissionForUser FAILS if stream not exist, or userentry not exist", async (): Promise<void> => {
            await expect(registry.getPermissionsForUser("0x00", await user.getAddress()))
                .to.be.revertedWith("error_streamDoesNotExist")
            expect(await registry.getPermissionsForUser(streamId, randomAddress()))
                .to.deep.equal([false, false, Zero, Zero, false])
        })

        it("FAILS for non-existing streams", async (): Promise<void> => {
            await expect(registry.getPermissionsForUser("0x0", await user.getAddress()))
                .to.be.revertedWith("error_streamDoesNotExist")
        })
    })

    describe("Signer-user permissions setters", () => {

        it("positivetest setPermissionForUser", async (): Promise<void> => {
            const otherUser1 = await randomUser()
            const registryConnectedToOtherUser1 = registry.connect(otherUser1)
            // grant him all permissions
            let blockTime = BigNumber.from(await getBlocktime()).add(1)
            await expect(await registry.setPermissionsForUser(streamId, otherUser1.address, true, true, blockTime, blockTime, true))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, otherUser1.address, true, true, blockTime, blockTime, true)
            expect(await registry.getPermissionsForUser(streamId, otherUser1.address))
                .to.deep.equal([true, true, blockTime, blockTime, true])
            // test if he can edit streammetadata
            await registryConnectedToOtherUser1.updateStreamMetadata(streamId, METADATA_1)
            expect(await registryConnectedToOtherUser1.getStreamMetadata(streamId)).to.equal(METADATA_1)
            blockTime = blockTime.add(1)
            // test if he can share, edit other permissions
            const otherUser2 = await randomUser()
            await expect(await registryConnectedToOtherUser1.setPermissionsForUser(streamId, otherUser2.address, true, true, blockTime, blockTime, true))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, otherUser2.address, true, true, blockTime, blockTime, true)
            expect(await registry.getPermissionsForUser(streamId, otherUser2.address))
                .to.deep.equal([true, true, blockTime, blockTime, true])
            // test if he can delete stream
            await registryConnectedToOtherUser1.deleteStream(streamId)
            await expect(registry.getStreamMetadata(streamId))
                .to.be.revertedWith("error_streamDoesNotExist")
        })

        it("setPermissionForUser FAILS for non-existent stream or if no GRANT permission", async (): Promise<void> => {
            const otherStreamPath = randomStreamPath()
            const otherStreamId = await getStreamId(user, otherStreamPath)
            await expect(registry.getPermissionsForUser(otherStreamId, await user.getAddress()))
                .to.be.revertedWith("error_streamDoesNotExist")
            const otherUser = await randomUser()
            const registryConnectedToOtherUser = registry.connect(otherUser)
            await expect(registryConnectedToOtherUser.setPermissionsForUser(otherStreamId, randomAddress(), true, true, 0, 0, true))
                .to.be.revertedWith("error_streamDoesNotExist")

            await registry.createStream(otherStreamPath, METADATA_0)
            await expect(registryConnectedToOtherUser.setPermissionsForUser(otherStreamId, randomAddress(), true, true, 0, 0, true))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("positivetest grantPermission, hasPermission", async (): Promise<void> => {
            const otherUser = await randomUser()
            await expect(await registry.grantPermission(streamId, await otherUser.getAddress(), PermissionType.Edit))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), true, false, Zero, Zero, false)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Edit))
                .to.equal(true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, false, Zero, Zero, false])

            await expect(await registry.grantPermission(streamId, await otherUser.getAddress(), PermissionType.Delete))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), true, true, Zero, Zero, false)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Delete))
                .to.equal(true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, Zero, Zero, false])

            await expect(await registry.grantPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), true, true, MaxUint256, Zero, false)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, MaxUint256, Zero, false])

            await expect(await registry.grantPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), true, true, MaxUint256, MaxUint256, false)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, MaxUint256, MaxUint256, false])

            await expect(await registry.grantPermission(streamId, await otherUser.getAddress(), PermissionType.Share))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), true, true, MaxUint256, MaxUint256, true)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Share))
                .to.equal(true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, MaxUint256, MaxUint256, true])
        })

        it("negativetest grantPermission", async (): Promise<void> => {
            const otherUser = await randomUser()
            const registryConnectedToOtherUser = registry.connect(otherUser)
            await expect(registryConnectedToOtherUser.grantPermission(streamId, randomAddress(), PermissionType.Edit))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryConnectedToOtherUser.grantPermission(streamId, randomAddress(), PermissionType.Delete))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryConnectedToOtherUser.grantPermission(streamId, randomAddress(), PermissionType.Publish))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryConnectedToOtherUser.grantPermission(streamId, randomAddress(), PermissionType.Subscribe))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryConnectedToOtherUser.grantPermission(streamId, randomAddress(), PermissionType.Share))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("positivetest revokePermission, hasPermission", async (): Promise<void> => {
            const otherUser = await randomUser()
            await registry.setPermissionsForUser(streamId, await otherUser.getAddress(), true, true, MaxUint256, MaxUint256, true)

            await expect(await registry.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Edit))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), false, true, MaxUint256, MaxUint256, true)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Edit))
                .to.equal(false)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, true, MaxUint256, MaxUint256, true])

            await expect(await registry.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Delete))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), false, false, MaxUint256, MaxUint256, true)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Delete))
                .to.equal(false)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, MaxUint256, MaxUint256, true])

            await expect(await registry.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), false, false, Zero, MaxUint256, true)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(false)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, Zero, MaxUint256, true])

            await expect(await registry.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), false, false, Zero, Zero, true)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(false)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, Zero, Zero, true])

            await expect(await registry.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Share))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, await otherUser.getAddress(), false, false, Zero, Zero, false)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Share))
                .to.equal(false)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, Zero, Zero, false])
        })

        it("negativetest grantPermission", async (): Promise<void> => {
            const otherUser = await randomUser()
            const registryConnectedToOtherUser = registry.connect(otherUser)
            await expect(registryConnectedToOtherUser.revokePermission(streamId, randomAddress(), PermissionType.Edit))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryConnectedToOtherUser.revokePermission(streamId, randomAddress(), PermissionType.Delete))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryConnectedToOtherUser.revokePermission(streamId, randomAddress(), PermissionType.Publish))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryConnectedToOtherUser.revokePermission(streamId, randomAddress(), PermissionType.Subscribe))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryConnectedToOtherUser.revokePermission(streamId, randomAddress(), PermissionType.Share))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("positivetest revokeAllPermissionsForUser, hasPermission", async (): Promise<void> => {
            const otherUser = await randomUser()
            const blocktime = await getBlocktime()
            await registry.setPermissionsForUser(streamId, await otherUser.getAddress(), true, true, blocktime, blocktime, true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true])
            await registry.revokeAllPermissionsForUser(streamId, await otherUser.getAddress())
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, Zero, Zero, false])
        })

        it("negativetest revokeAllPermissionsForUser", async (): Promise<void> => {
            const otherUser = await randomUser()
            await registry.grantPermission(streamId, await otherUser.getAddress(), PermissionType.Share)
            await registry.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Share)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Share))
                .to.equal(false)
            await expect(registry.connect(otherUser).revokeAllPermissionsForUser(streamId, randomAddress()))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("positivetest setPermissions", async (): Promise<void> => {
            const userA = randomAddress()
            const userB = randomAddress()
            const permissionA = {
                canEdit: true,
                canDelete: false,
                publishExpiration: MaxUint256,
                subscribeExpiration: MaxUint256,
                canGrant: false
            }
            const permissionB = {
                canEdit: false,
                canDelete: true,
                publishExpiration: 1,
                subscribeExpiration: 1,
                canGrant: true
            }

            await registry.setPermissions(streamId, [userA, userB], [permissionA, permissionB])
            expect(await registry.getDirectPermissionsForUser(streamId, userA))
                .to.deep.equal([true, false, MaxUint256, MaxUint256, false])
            expect(await registry.getDirectPermissionsForUser(streamId, userB))
                .to.deep.equal([false, true, BigNumber.from(1), BigNumber.from(1), true])
        })

        it("positivetest setPermissionsMultipleStreams", async (): Promise<void> => {
            const userA = randomAddress()
            const userB = randomAddress()
            const otherStreamId = await createStream()
            const permissionA = {
                canEdit: true,
                canDelete: false,
                publishExpiration: MaxUint256,
                subscribeExpiration: MaxUint256,
                canGrant: false
            }
            const permissionB = {
                canEdit: false,
                canDelete: true,
                publishExpiration: 1,
                subscribeExpiration: 1,
                canGrant: true
            }
            await registry.setPermissionsMultipleStreams([streamId, otherStreamId],
                [[userA, userB], [userA, userB]], [[permissionA, permissionB], [permissionA, permissionB]])
            expect(await registry.getDirectPermissionsForUser(streamId, userA))
                .to.deep.equal([true, false, MaxUint256, MaxUint256, false])
            expect(await registry.getDirectPermissionsForUser(streamId, userB))
                .to.deep.equal([false, true, BigNumber.from(1), BigNumber.from(1), true])
            expect(await registry.getDirectPermissionsForUser(otherStreamId, userA))
                .to.deep.equal([true, false, MaxUint256, MaxUint256, false])
            expect(await registry.getDirectPermissionsForUser(otherStreamId, userB))
                .to.deep.equal([false, true, BigNumber.from(1), BigNumber.from(1), true])
        })

        it("positivetest setExpirationTime", async (): Promise<void> => {
            const otherUser = await randomUser()
            const date = BigNumber.from(Date.now()).div(1000).add(10000)
            await registry.setPermissionsForUser(streamId, await otherUser.getAddress(), true, true, MaxUint256, MaxUint256, true)
            await expect(registry.setExpirationTime(streamId, await otherUser.getAddress(), PermissionType.Publish, date))
                .to.emit(registry, "PermissionUpdated").withArgs(streamId, await otherUser.getAddress(), true, true, date, MaxUint256, true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, date, MaxUint256, true])
            await expect(registry.setExpirationTime(streamId, await otherUser.getAddress(), PermissionType.Subscribe, date))
                .to.emit(registry, "PermissionUpdated").withArgs(streamId, await otherUser.getAddress(), true, true, date, date, true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, date, date, true])
        })

        it("negativetest setExpirationTime", async (): Promise<void> => {
            await expect(registry.setExpirationTime(streamId, randomAddress(), PermissionType.Edit, 7))
                .to.be.revertedWith("error_timeOnlyObPubSub")
            await expect(registry.setExpirationTime(streamId, randomAddress(), PermissionType.Delete, 7))
                .to.be.revertedWith("error_timeOnlyObPubSub")
            await expect(registry.setExpirationTime(streamId, randomAddress(), PermissionType.Share, 7))
                .to.be.revertedWith("error_timeOnlyObPubSub")
        })

        it("positivetest revoke own permissions without share", async (): Promise<void> => {
            const otherUser = await randomUser()
            const registryConnectedToOtherUser = registry.connect(otherUser)
            await registry.setPermissionsForUser(streamId, await otherUser.getAddress(), true, true,
                MaxUint256, MaxUint256, false)
            await registryConnectedToOtherUser.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Edit)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, true, MaxUint256, MaxUint256, false])
            await registryConnectedToOtherUser.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Delete)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, MaxUint256, MaxUint256, false])
            await registryConnectedToOtherUser.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Publish)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, Zero, MaxUint256, false])
            await registryConnectedToOtherUser.revokePermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, Zero, Zero, false])
        })

        it("negativetest revokeAllPermissionsForUser", async (): Promise<void> => {
            const otherUser = await randomUser()
            await registry.setPermissionsForUser(streamId, await otherUser.getAddress(),
                true, true, MaxUint256, MaxUint256, false)
            await registry.connect(otherUser).revokeAllPermissionsForUser(streamId, await otherUser.getAddress())
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, Zero, Zero, false])
        })

        it("edgecases expirationtime", async (): Promise<void> => {
            const otherUser = await randomUser()
            const blocktime = await getBlocktime() + 1
            await registry.setPermissionsForUser(streamId, await otherUser.getAddress(), true, true, blocktime, blocktime, true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true])
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(true)
            expect(await registry.hasDirectPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(true)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(true)
            expect(await registry.hasDirectPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(true)
            // setting it again will advance the blocktime and expire the rights
            await registry.setPermissionsForUser(streamId, await otherUser.getAddress(), true, true, blocktime, blocktime, true)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true])
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasDirectPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(false)
            expect(await registry.hasDirectPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(false)
            // give public publish permission, check again
            await registry.setPublicPermission(streamId, blocktime + 2, blocktime + 2)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(true)
            expect(await registry.hasDirectPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(true)
            expect(await registry.hasDirectPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(false)
            // setting it again (one more transaction) with the same number will advance the blocktime and expire the rights
            await registry.setPublicPermission(streamId, blocktime + 2, blocktime + 2)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasDirectPermission(streamId, await otherUser.getAddress(), PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(false)
            expect(await registry.hasDirectPermission(streamId, await otherUser.getAddress(), PermissionType.Subscribe))
                .to.equal(false)
        })
    })

    describe("Bytes-id user permissions", () => {
        it("grantPermissionForUserId happy path", async (): Promise<void> => {
            await expect(registry.grantPermissionForUserId(streamId, USER_ID, PermissionType.Publish))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, USER_ID, false, false, MaxUint256, Zero, false)
            expect(await registry.getPermissionsForUserId(streamId, USER_ID))
                .to.deep.equal([false, false, MaxUint256, Zero, false])
            expect(await registry.getDirectPermissionsForUserId(streamId, USER_ID))
                .to.deep.equal([false, false, MaxUint256, Zero, false])
        })

        it("revokePermissionForUserId happy path", async (): Promise<void> => {
            await (await registry.grantPermissionForUserId(streamId, USER_ID, PermissionType.Subscribe)).wait()
            await expect(registry.revokePermissionForUserId(streamId, USER_ID, PermissionType.Publish))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, USER_ID, false, false, Zero, MaxUint256, false)
            await expect(registry.revokePermissionForUserId(streamId, USER_ID, PermissionType.Subscribe))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, USER_ID, false, false, Zero, Zero, false)
            expect(await registry.getPermissionsForUserId(streamId, USER_ID))
                .to.deep.equal([false, false, Zero, Zero, false])
        })

        it("revokeAllPermissionsForUserId happy path", async (): Promise<void> => {
            await (await registry.grantPermissionForUserId(streamId, USER_ID, PermissionType.Publish)).wait()
            await (await registry.grantPermissionForUserId(streamId, USER_ID, PermissionType.Subscribe)).wait()
            await expect(registry.revokeAllPermissionsForUserId(streamId, USER_ID))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, USER_ID, false, false, Zero, Zero, false)
            expect(await registry.getPermissionsForUserId(streamId, USER_ID))
                .to.deep.equal([false, false, Zero, Zero, false])
        })

        it("setExpirationTimeForUserId happy path", async (): Promise<void> => {
            const date = BigNumber.from(Date.now()).div(1000).add(10000)
            await registry.setPermissionsForUserIds(streamId, [ USER_ID ], [ PUB_SUB_ONLY_PERMISSIONS_STRUCT ])
            await expect(registry.setExpirationTimeForUserId(streamId, USER_ID, PermissionType.Subscribe, date))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, USER_ID, false, false, MaxUint256, date, false)
            await expect(registry.setExpirationTimeForUserId(streamId, USER_ID, PermissionType.Publish, date))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, USER_ID, false, false, date, date, false)
        })

        // it("createStreamWithPermissionsForUserId happy path", async (): Promise<void> => {
        //     const streamPath = "/test-createStreamWithPermissionsForUserId-" + Date.now()
        //     const streamId = admin.address.toLowerCase() + streamPath
        //     await expect(registry.createStreamWithPermissionsForUserIds(streamPath, "{}", [userBytesId, userBytesId + "01"], [
        //         {...zeroPermissionStruct, subscribeExpiration: MaxUint256},
        //         {...zeroPermissionStruct, subscribeExpiration: MaxUint256, publishExpiration: MaxUint256}
        //     ])) .to.emit(registry, "StreamCreated").withArgs(streamId, "{}")
        //         .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, userBytesId, false, false, Zero, MaxUint256, false)
        //         .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, userBytesId + "01", false, false, MaxUint256, MaxUint256, false)
        // })

        it("setMultipleStreamPermissionsForUserIds happy path", async (): Promise<void> => {
            const perms = { ...NO_PERMISSIONS_STRUCT, subscribeExpiration: MaxUint256 }
            await expect(registry.setMultipleStreamPermissionsForUserIds([streamId, streamId], [[USER_ID], [USER_ID]], [[perms], [perms]]))
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, USER_ID, false, false, Zero, MaxUint256, false)
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, USER_ID, false, false, Zero, MaxUint256, false)
        })

        it("setPermissionsForUserIds happy path", async (): Promise<void> => {
            await expect(registry.setPermissionsForUserIds(streamId, [ USER_ID ], [ ALL_PERMISSIONS_STRUCT ]))
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, USER_ID, true, true, MaxUint256, MaxUint256, true)
            await expect(registry.setPermissionsForUserIds(streamId, [ USER_ID ], [ NO_PERMISSIONS_STRUCT ]))
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, USER_ID, false, false, 0, 0, false)
            await expect(registry.setPermissionsForUserIds(streamId, [ USER_ID ], [ PUB_SUB_ONLY_PERMISSIONS_STRUCT ]))
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, USER_ID, false, false, MaxUint256, MaxUint256, false)
        })

        it("setExpirationTimeForUserId FAILS for non-existent stream / no grant permission", async (): Promise<void> => {
            await expect(registry.setExpirationTimeForUserId("0x00", USER_ID, PermissionType.Publish, MaxUint256))
                .to.be.revertedWith("error_streamDoesNotExist")
            const otherUser = await randomUser()
            await expect(registry.connect(otherUser).setExpirationTimeForUserId(streamId, USER_ID, PermissionType.Publish, MaxUint256))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("setPermissionsForUserIds FAILS for non-existent stream / no grant permission", async (): Promise<void> => {
            await expect(registry.setPermissionsForUserIds("0x00", [USER_ID], [NO_PERMISSIONS_STRUCT]))
                .to.be.revertedWith("error_streamDoesNotExist")
            const otherUser = await randomUser()
            await expect(registry.connect(otherUser).setPermissionsForUserIds(streamId, [USER_ID], [NO_PERMISSIONS_STRUCT]))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("setMultipleStreamPermissionsForUserIds FAILS for non-existent stream / no grantperm / arg-length mismatch", async (): Promise<void> => {
            const perms = { ...NO_PERMISSIONS_STRUCT, subscribeExpiration: MaxUint256 }
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId, "0x00"],
                [[USER_ID], [USER_ID]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_streamDoesNotExist")
            const otherUser = await randomUser()
            await expect(registry.connect(otherUser).setMultipleStreamPermissionsForUserIds(
                [streamId, "0x00"],
                [[USER_ID], [USER_ID]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_noSharePermission")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId],
                [[USER_ID], [USER_ID]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId, streamId],
                [[USER_ID]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId, streamId],
                [[USER_ID], [USER_ID]],
                [[perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId, streamId],
                [[USER_ID, USER_ID], [USER_ID]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId, streamId],
                [[USER_ID], [USER_ID]],
                [[perms], [perms, perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
        })

        it("should work with addresses just like non-bytes-id functions", async (): Promise<void> => {
            const otherUser = await randomUser()
            expect(await registry.getPermissionsForUserId(streamId, await otherUser.getAddress())).to.deep.equal([false, false, Zero, Zero, false])
            await (await registry.grantPermission(streamId, await otherUser.getAddress(), PermissionType.Publish)).wait()
            expect(await registry.getPermissionsForUserId(streamId, await otherUser.getAddress())).to.deep.equal([false, false, MaxUint256, Zero, false])
            await (await registry.revokeAllPermissionsForUserId(streamId, await otherUser.getAddress())).wait()
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress())).to.deep.equal([false, false, Zero, Zero, false])
            await (await registry.grantPermissionForUserId(streamId, await otherUser.getAddress(), PermissionType.Subscribe)).wait()
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress())).to.deep.equal([false, false, Zero, MaxUint256, false])
            await (await registry.revokeAllPermissionsForUser(streamId, await otherUser.getAddress())).wait()
            expect(await registry.getPermissionsForUserId(streamId, await otherUser.getAddress())).to.deep.equal([false, false, Zero, Zero, false])
        })
    })

    describe("Public permission get/set", () => {
        it("works using grantPublicPermission", async (): Promise<void> => {
            const otherUser = await randomUser()
            await registry.grantPublicPermission(streamId, PermissionType.Publish)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, MaxUint256, Zero, false])
            await registry.grantPublicPermission(streamId, PermissionType.Subscribe)
            expect(await registry.getPermissionsForUser(streamId, await otherUser.getAddress()))
                .to.deep.equal([false, false, MaxUint256, MaxUint256, false])
            expect(await registry.hasPublicPermission(streamId, PermissionType.Publish)).to.equal(true)
            expect(await registry.hasPublicPermission(streamId, PermissionType.Subscribe)).to.equal(true)
            expect(await registry.hasPublicPermission(streamId, PermissionType.Edit)).to.equal(false)
            expect(await registry.hasPublicPermission(streamId, PermissionType.Delete)).to.equal(false)
            expect(await registry.hasPublicPermission(streamId, PermissionType.Share)).to.equal(false)
        })

        it("works using revokePublicPermission", async (): Promise<void> => {
            await registry.setPublicPermission(streamId, MaxUint256, MaxUint256)
            await registry.revokePublicPermission(streamId, PermissionType.Publish)
            expect(await registry.getPermissionsForUser(streamId, randomAddress()))
                .to.deep.equal([false, false, Zero, MaxUint256, false])
            await registry.revokePublicPermission(streamId, PermissionType.Subscribe)
            expect(await registry.getPermissionsForUser(streamId, randomAddress()))
                .to.deep.equal([false, false, Zero, Zero, false])
        })

        it("works using setPublicPermission", async (): Promise<void> => {
            await registry.setPublicPermission(streamId, MaxUint256, MaxUint256)
            expect(await registry.getPermissionsForUser(streamId, randomAddress()))
                .to.deep.equal([false, false, MaxUint256, MaxUint256, false])
            const blocktime = await getBlocktime() + 1
            await registry.setPublicPermission(streamId, blocktime, blocktime)
            expect(await registry.getPermissionsForUser(streamId, randomAddress()))
                .to.deep.equal([false, false, BigNumber.from(blocktime), BigNumber.from(blocktime), false])
            await registry.setPublicPermission(streamId, 0, 0)
            expect(await registry.getPermissionsForUser(streamId, randomAddress()))
                .to.deep.equal([false, false, Zero, Zero, false])
        })

        it("FAILS for edit/delete/share in grantPublicPermission", async (): Promise<void> => {
            await expect(registry.grantPublicPermission(streamId, PermissionType.Edit))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.grantPublicPermission(streamId, PermissionType.Delete))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.grantPublicPermission(streamId, PermissionType.Share))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("FAILS for edit/delete/share in setPermissionsForUser", async (): Promise<void> => {
            await expect(registry.setPermissionsForUser(streamId, AddressZero, true, false, 0, 0, false))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.setPermissionsForUser(streamId, AddressZero, false, true, 0, 0, false))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.setPermissionsForUser(streamId, AddressZero, false, false, 0, 0, true))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("FAILS for edit/delete/share in revokePublicPermission", async (): Promise<void> => {
            await expect(registry.revokePublicPermission(streamId, PermissionType.Edit))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.revokePublicPermission(streamId, PermissionType.Delete))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.revokePublicPermission(streamId, PermissionType.Share))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("FAILS for edit/delete/share in setPermissions", async (): Promise<void> => {
            await expect(registry.setPermissions(streamId, [AddressZero], [ALL_PERMISSIONS_STRUCT]))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.setPermissions(streamId, [AddressZero], [PUB_SUB_ONLY_PERMISSIONS_STRUCT]))
                .to.not.be.reverted
        })

        it("FAILS for edit/delete/share in setPermissionsMultipleStreams", async (): Promise<void> => {
            await expect(registry.setPermissionsMultipleStreams([streamId], [[AddressZero]], [[ALL_PERMISSIONS_STRUCT]]))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.setPermissionsMultipleStreams([streamId], [[AddressZero]], [[PUB_SUB_ONLY_PERMISSIONS_STRUCT]]))
                .to.not.be.reverted
        })

        it("FAILS for edit/delete/share in grantPermission", async (): Promise<void> => {
            await expect(registry.grantPermission(streamId, AddressZero, PermissionType.Edit))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.grantPermission(streamId, AddressZero, PermissionType.Delete))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.grantPermission(streamId, AddressZero, PermissionType.Share))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("FAILS for edit/delete/share in revokePermission", async (): Promise<void> => {
            await expect(registry.revokePermission(streamId, AddressZero, PermissionType.Edit))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.revokePermission(streamId, AddressZero, PermissionType.Delete))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.revokePermission(streamId, AddressZero, PermissionType.Share))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("FAILS for edit/delete/share in grantPermissionForUserId", async (): Promise<void> => {
            await expect(registry.grantPermissionForUserId(streamId, AddressZero, PermissionType.Edit))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.grantPermissionForUserId(streamId, AddressZero, PermissionType.Delete))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.grantPermissionForUserId(streamId, AddressZero, PermissionType.Share))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("FAILS for edit/delete/share in revokePermissionForUserId", async (): Promise<void> => {
            await expect(registry.revokePermissionForUserId(streamId, AddressZero, PermissionType.Edit))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.revokePermissionForUserId(streamId, AddressZero, PermissionType.Delete))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.revokePermissionForUserId(streamId, AddressZero, PermissionType.Share))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("FAILS for edit/delete/share in setPermissionsForUserIds", async (): Promise<void> => {
            await expect(registry.setPermissionsForUserIds(streamId, [AddressZero], [ALL_PERMISSIONS_STRUCT]))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.setPermissionsForUserIds(streamId, [AddressZero], [PUB_SUB_ONLY_PERMISSIONS_STRUCT]))
                .to.not.be.reverted
        })

        it("FAILS for edit/delete/share in setMultipleStreamPermissionsForUserIds", async (): Promise<void> => {
            await expect(registry.setMultipleStreamPermissionsForUserIds([streamId], [[AddressZero]], [[ALL_PERMISSIONS_STRUCT]]))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.setMultipleStreamPermissionsForUserIds([streamId], [[AddressZero]], [[PUB_SUB_ONLY_PERMISSIONS_STRUCT]]))
                .to.not.be.reverted
        })
    })

    describe("EIP-2771 meta-transactions feature", () => {
        async function getCreateStreamMetaTx({
            forwarder = minimalForwarder,
            signer = Wallet.createRandom(),
            gas
        }: { forwarder?: MinimalForwarder; signer?: Wallet; gas?: string } = {}) {
            // signerWallet is creating and signing transaction, user is posting it and paying for gas
            // in the positive case signkey is the same as signerWallet.privateKey
            const path = "/path" + Wallet.createRandom().address
            const metadata = "metadata"
            const data = await registry.interface.encodeFunctionData("createStream", [path, metadata])
            const { request, signature } = await getEIP2771MetaTx(registry.address, data, forwarder, signer, gas)
            return { request, signature, path, metadata, signer }
        }

        it("works as expected (happy path)", async (): Promise<void> => {
            const { request, signature, path, metadata, signer } = await getCreateStreamMetaTx()
            const signatureIsValid = await minimalForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            const receipt = await (await minimalForwarder.execute(request, signature)).wait()
            expect(receipt.logs.length).to.equal(2)
            const id = await getStreamId(signer, path)
            expect(await registry.getStreamMetadata(id)).to.equal(metadata)
        })

        it("FAILS with wrong forwarder (negativetest)", async (): Promise<void> => {
            log("Deploy second minimal forwarder")
            const minimalForwarderFromUser0Factory = await hardhatEthers.getContractFactory("MinimalForwarder", forwarderUser)
            const wrongForwarder = await minimalForwarderFromUser0Factory.deploy() as MinimalForwarder
            await wrongForwarder.deployed()

            log("Check that the correct forwarder is set")
            expect(await registry.isTrustedForwarder(minimalForwarder.address)).to.be.true
            expect(await registry.isTrustedForwarder(wrongForwarder.address)).to.be.false

            log("Metatx seems to succeed with the wrong forwarder")
            const { request, signature, path, signer } = await getCreateStreamMetaTx({ forwarder: wrongForwarder })
            const signatureIsValid = await wrongForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            const receipt = await (await wrongForwarder.execute(request, signature)).wait()
            expect(receipt.logs.length).to.equal(2)

            log("Tx failed, so stream wasn't created")
            const id = await getStreamId(signer, path)
            await expect(registry.getStreamMetadata(id)).to.be.revertedWith("error_streamDoesNotExist")
        })

        it("FAILS with wrong signature (negativetest)", async (): Promise<void> => {
            const wrongSigner = Wallet.createRandom()
            const { request } = await getCreateStreamMetaTx()
            const { signature } = await getCreateStreamMetaTx({ signer: wrongSigner })
            const signatureIsValid = await minimalForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.false
            await expect(minimalForwarder.execute(request, signature))
                .to.be.revertedWith("MinimalForwarder: signature does not match request")
        })

        it("FAILS with not enough gas in internal transaction call (negativetest)", async (): Promise<void> => {
            log("Create a valid signature with too little gas for the tx")
            const { request, signature, path } = await getCreateStreamMetaTx({ gas: "1000" })
            const signatureIsValid = await minimalForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            const receipt = await (await minimalForwarder.execute(request, signature)).wait()
            expect(receipt.logs.length).to.equal(0)

            log("Tx failed, so stream wasn't created")
            const id = await getStreamId(user, path)
            await expect(registry.getStreamMetadata(id))
                .to.be.revertedWith("error_streamDoesNotExist")
        })

        it("works after resetting trusted forwarder (positivetest)", async (): Promise<void> => {
            log("Deploy second minimal forwarder")
            const minimalForwarderFromUser0Factory = await hardhatEthers.getContractFactory("MinimalForwarder", forwarderUser)
            const newForwarder = await minimalForwarderFromUser0Factory.deploy() as MinimalForwarder
            await newForwarder.deployed()

            log("Set new forwarder")
            const admin = await getAdmin()
            await registry.connect(admin).grantRole(await registry.TRUSTED_ROLE(), await admin.getAddress())
            await registry.connect(admin).setTrustedForwarder(newForwarder.address)

            log("Check that the correct forwarder is set")
            expect(await registry.isTrustedForwarder(minimalForwarder.address)).to.be.false
            expect(await registry.isTrustedForwarder(newForwarder.address)).to.be.true

            log("Check that metatx works with new forwarder")
            const { request, signature, path, metadata, signer } = await getCreateStreamMetaTx({ forwarder: newForwarder })
            const signatureIsValid = await newForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            const receipt = await (await newForwarder.execute(request, signature)).wait()
            expect(receipt.logs.length).to.equal(2)
            const id = await getStreamId(signer, path)
            expect(await registry.getStreamMetadata(id)).to.equal(metadata)

            log("Set old forwarder ack")

            await registry.connect(admin).setTrustedForwarder(minimalForwarder.address)
            await registry.connect(admin).revokeRole(await registry.TRUSTED_ROLE(), await admin.getAddress())
        })

        it("recognizes the trusted forwarder (positivetest)", async (): Promise<void> => {
            expect(await registry.isTrustedForwarder(minimalForwarder.address))
                .to.equal(true)
        })

        it("PREVENTS resetting trusted forwarder if caller not trusted (negativetest)", async (): Promise<void> => {
            const otherUser = await randomUser()
            await expect(registry.connect(otherUser).setTrustedForwarder(Wallet.createRandom().address))
                .to.be.revertedWith("error_mustBeTrustedRole")
        })
    })

    describe('ENS cache', () => {
        it("positivetest setEnsCache", async (): Promise<void> => {
            const role = await registry.TRUSTED_ROLE()
            const has = await registry.hasRole(role, await trustedUser.getAddress())
            expect(has).to.equal(true)
            await registry.connect(trustedUser).setEnsCache("0x0000000000000000000000000000000000000000")
        })
    })
})
