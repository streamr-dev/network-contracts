import { upgrades, ethers } from "hardhat"
import { expect } from "chai"
import Debug from "debug"

import type { Wallet as WalletType } from "@ethersproject/wallet"
import type { BigNumber as BigNumberType } from "ethers"

import { getEIP2771MetaTx } from "./getEIP2771MetaTx"
import type { MinimalForwarder } from "../../../typechain"
import type { StreamRegistry } from "../../../src/exports"

const log = Debug("Streamr::test::StreamRegistry")

const {
    Wallet,
    BigNumber,
    constants: { AddressZero }
} = ethers

const ZERO = BigNumber.from(0) as BigNumberType
const MAX_INT = BigNumber.from(2).pow(256).sub(1) as BigNumberType
const zeroPermissionStruct: StreamRegistry.PermissionStruct = {
    canEdit: false,
    canDelete: false,
    publishExpiration: ZERO,
    subscribeExpiration: ZERO,
    canGrant: false,
}
const allPermissionsStruct: StreamRegistry.PermissionStruct = {
    canEdit: true,
    canDelete: true,
    publishExpiration: MAX_INT,
    subscribeExpiration: MAX_INT,
    canGrant: true,
}
const pubSubOnlyStruct: StreamRegistry.PermissionStruct = {
    canEdit: false,
    canDelete: false,
    publishExpiration: MAX_INT,
    subscribeExpiration: MAX_INT,
    canGrant: false,
}

// eslint-disable-next-line no-unused-vars
enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Share }

const getBlocktime = async (): Promise<number> => {
    // const blocknumber = await ethers.provider.getBlockNumber()
    const block = await ethers.provider.getBlock("latest")
    return block.timestamp
}

describe.only("StreamRegistry", async (): Promise<void> => {
    let wallets: WalletType[]
    // let ensCacheFromAdmin: ENSCache
    let registry: StreamRegistry
    let registryFromUser0: StreamRegistry
    let registryFromUser1: StreamRegistry
    let registryFromMigrator: StreamRegistry
    let minimalForwarderFromUser0: MinimalForwarder
    let blocktime: number
    // let registryFromUser1: StreamRegistry
    let adminAddress: string
    let user0Address: string
    let user1Address: string
    let trustedAddress: string
    const streamPath0 = "/streamPath0"
    const streamPath1 = "/streamPath1"
    const streamPath2 = "/streamPath2"
    let streamId0: string
    let streamId1: string
    let streamId2: string
    const metadata0 = "streammetadata0"
    const metadata1 = "streammetadata1"

    let admin: WalletType
    const userBytesId = "0x" + Array(64).join("0123456789abcdef") // repeat string X times

    before(async (): Promise<void> => {
        wallets = await ethers.getSigners()
        admin = wallets[0]
        adminAddress = wallets[0].address
        user0Address = wallets[1].address
        user1Address = wallets[2].address
        trustedAddress = wallets[3].address
        streamId0 = adminAddress.toLowerCase() + streamPath0
        streamId1 = adminAddress.toLowerCase() + streamPath1
        streamId2 = adminAddress.toLowerCase() + streamPath2
        const minimalForwarderFromUser0Factory = await ethers.getContractFactory("MinimalForwarder", wallets[9])
        minimalForwarderFromUser0 = await minimalForwarderFromUser0Factory.deploy() as MinimalForwarder
        const streamRegistryFactoryV2 = await ethers.getContractFactory("StreamRegistryV2", wallets[0])
        const streamRegistryFactoryV2Tx = await upgrades.deployProxy(streamRegistryFactoryV2, [
            "0x0000000000000000000000000000000000000000",
            minimalForwarderFromUser0.address
        ], { kind: "uups" })
        const registryV2FromAdmin = await streamRegistryFactoryV2Tx.deployed() as StreamRegistry
        // to upgrade the deployer must also have the trusted role
        // we will grant it and revoke it after the upgrade to keep admin and trusted roles separate
        await registryV2FromAdmin.grantRole(await registryV2FromAdmin.TRUSTED_ROLE(), wallets[0].address)
        const streamregistryFactoryV3 = await ethers.getContractFactory("StreamRegistryV3", wallets[0])
        const streamRegistryFactoryV3Tx = await upgrades.upgradeProxy(streamRegistryFactoryV2Tx.address, streamregistryFactoryV3)
        await streamRegistryFactoryV3Tx.deployed() as StreamRegistry
        //also upgrade the registry to V5
        const streamRegistryFactory = await ethers.getContractFactory("StreamRegistryV5", wallets[0])
        const streamRegistryDeployTx = await upgrades.upgradeProxy(streamRegistryFactoryV3Tx.address, streamRegistryFactory)
        await registryV2FromAdmin.revokeRole(await registryV2FromAdmin.TRUSTED_ROLE(), wallets[0].address)
        // eslint-disable-next-line require-atomic-updates

        // cover also `initialize` of the newest version
        await upgrades.deployProxy(streamRegistryFactory, [
            "0x0000000000000000000000000000000000000000",
            minimalForwarderFromUser0.address
        ], { kind: "uups" })

        const registryContract = await streamRegistryDeployTx.deployed() as StreamRegistry
        registry = registryContract.connect(admin)
        registryFromUser0 = registry.connect(wallets[1] as any)
        registryFromUser1 = registry.connect(wallets[2] as any)
        registryFromMigrator = registry.connect(wallets[3] as any)
        // MAX_INT = await registry.MAX_INT()
        await registry.grantRole(await registry.TRUSTED_ROLE(), trustedAddress)

        await registry.createStream(streamPath1, metadata1)
    })

    let streamIndex = 0
    async function createStream(owner = admin): Promise<string> {
        const streamPath = "/test-" + (streamIndex++)
        const streamId = owner.address.toLowerCase() + streamPath
        const metadata = `{"meta":"${Date.now()}"}`
        await (await registry.connect(owner).createStream(streamPath, metadata)).wait()
        return streamId
    }

    describe("Stream creation", () => {

        it("positivetest createStream + event, get description", async (): Promise<void> => {
            await expect(await registry.createStream(streamPath0, metadata0))
                .to.emit(registry, "StreamCreated")
                .withArgs(streamId0, metadata0)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId0, adminAddress, true, true, MAX_INT, MAX_INT, true)
            expect(await registry.streamIdToMetadata(streamId0)).to.equal(metadata0)
        })

        it("positivetest createStream path character edgecases", async (): Promise<void> => {
            expect(await registry.createStream("/", metadata0))
                .to.not.throw
            expect(await registry.createStream("/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./_-", metadata0))
                .to.not.throw
        })

        it("FAILS for empty metadata", async (): Promise<void> => {
            await expect(registry.createStream("/test", ""))
                .to.be.revertedWith("error_metadataJsonStringIsEmpty")
        })

        it("negativetest createStream path character edgecases", async (): Promise<void> => {
            await expect(registry.createStream("/,", metadata0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/:", metadata0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/@", metadata0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/[", metadata0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/`", metadata0))
                .to.be.revertedWith("error_invalidPathChars")
            await expect(registry.createStream("/{", metadata0))
                .to.be.revertedWith("error_invalidPathChars")
        })

        it("negativetest createStream, already exists error", async (): Promise<void> => {
            await expect(registry.createStream(streamPath0, metadata0))
                .to.be.revertedWith("error_streamAlreadyExists")
        })

        it("negativetest createStream, path not starting with slash", async (): Promise<void> => {
            await expect(registry.createStream("pathWithoutSalsh", metadata0))
                .to.be.revertedWith("error_pathMustStartWithSlash")
        })

        it("positivetest createStreamWithPermissions", async (): Promise<void> => {
            const newStreamPath = "/" + Wallet.createRandom().address
            const newStreamId = adminAddress.toLowerCase() + newStreamPath
            const permissionA = {
                canEdit: true,
                canDelete: false,
                publishExpiration: MAX_INT,
                subscribeExpiration: MAX_INT,
                canGrant: true
            }
            const permissionB = {
                canEdit: false,
                canDelete: false,
                publishExpiration: 7,
                subscribeExpiration: 7,
                canGrant: false
            }
            await expect(await registry.createStreamWithPermissions(newStreamPath, metadata1,
                [adminAddress, trustedAddress], [permissionA, permissionB]))
                // [trustedAddress], [permissionB]))
                .to.emit(registry, "StreamCreated")
                .withArgs(newStreamId, metadata1)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId, adminAddress, true, true, MAX_INT, MAX_INT, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId, adminAddress, true, false, MAX_INT, MAX_INT, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId, trustedAddress, false, false, 7, 7, false)
            expect(await registry.getStreamMetadata(newStreamId)).to.equal(metadata1)
        })

        it("positivetest createMultipleStreamsWithPermissions", async (): Promise<void> => {
            const newStreamPath1 = "/" + Wallet.createRandom().address
            const newStreamPath2 = "/" + Wallet.createRandom().address
            const newStreamId1 = adminAddress.toLowerCase() + newStreamPath1
            const newStreamId2 = adminAddress.toLowerCase() + newStreamPath2
            const permissionA = {
                canEdit: true,
                canDelete: false,
                publishExpiration: MAX_INT,
                subscribeExpiration: MAX_INT,
                canGrant: true
            }
            const permissionB = {
                canEdit: false,
                canDelete: false,
                publishExpiration: 7,
                subscribeExpiration: 7,
                canGrant: false
            }
            await expect(await registry.createMultipleStreamsWithPermissions(
                [newStreamPath1, newStreamPath2], [metadata1, metadata1], [[adminAddress, trustedAddress],
                    [adminAddress, trustedAddress]], [[permissionA, permissionB], [permissionA, permissionB]]))
                .to.emit(registry, "StreamCreated")
                .withArgs(newStreamId1, metadata1)
                .to.emit(registry, "StreamCreated")
                .withArgs(newStreamId2, metadata1)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId1, adminAddress, true, true, MAX_INT, MAX_INT, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId2, adminAddress, true, true, MAX_INT, MAX_INT, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId1, adminAddress, true, false, MAX_INT, MAX_INT, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId2, adminAddress, true, false, MAX_INT, MAX_INT, true)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId1, trustedAddress, false, false, 7, 7, false)
                .to.emit(registry, "PermissionUpdated")
                .withArgs(newStreamId2, trustedAddress, false, false, 7, 7, false)
            expect(await registry.getStreamMetadata(newStreamId1)).to.equal(metadata1)
            expect(await registry.getStreamMetadata(newStreamId2)).to.equal(metadata1)
        })

        // test if create stream->delete stream->recreate stream with same id also wipes
        // all permissions (not trivial since you can't delete mappings)
        it("recreate stream with same id wipes permissions", async (): Promise<void> => {
            await registry.deleteStream(streamId0)
            await registry.createStream(streamPath0, metadata0)
            // give user0 all permissions
            await registry.setPermissionsForUser(streamId0, user0Address,
                true, true, MAX_INT, MAX_INT, true)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([true, true, MAX_INT, MAX_INT, true].toString())
            // delete stream, and recreate with same id
            await registry.deleteStream(streamId0)
            await registry.createStream(streamPath0, metadata0)
            // check that user0 has no permission
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
        })
    })

    describe("Stream metadata", () => {

        it("positivetest getStreamMetadata", async (): Promise<void> => {
            expect(await registry.getStreamMetadata(streamId0)).to.equal(metadata0)
        })

        it("positivetest setEnsCache", async (): Promise<void> => {
            const role = await registry.TRUSTED_ROLE()
            const has = await registry.hasRole(role, trustedAddress)
            expect(has).to.equal(true)
            await registryFromMigrator.setEnsCache("0x0000000000000000000000000000000000000000")
        })

        it("negativetest getStreamMetadata, stream doesn't exist", async (): Promise<void> => {
            await expect(registry.getStreamMetadata("0x00")).to.be.revertedWith("error_streamDoesNotExist")
        })

        it("positivetest updateStreamMetadata + event", async (): Promise<void> => {
            expect(await registry.getStreamMetadata(streamId0)).to.equal(metadata0)
            await expect(await registry.updateStreamMetadata(streamId0, metadata1))
                .to.emit(registry, "StreamUpdated")
                .withArgs(streamId0, metadata1)
            expect(await registry.getStreamMetadata(streamId0)).to.equal(metadata1)
        })

        it("negativetest updateStreamMetadata, not exist, no right", async (): Promise<void> => {
            await expect(registry.updateStreamMetadata("0x00", metadata0))
                .to.be.revertedWith("error_streamDoesNotExist")
            await expect(registryFromUser0.updateStreamMetadata(streamId0, metadata0))
                .to.be.revertedWith("error_noEditPermission")
        })
    })

    describe("Stream deletion", () => {

        it("positivetest deleteStream + event", async (): Promise<void> => {
            expect(await registry.getStreamMetadata(streamId0)).to.equal(metadata1)
            await expect(await registry.deleteStream(streamId0))
                .to.emit(registry, "StreamDeleted")
                .withArgs(streamId0)
            await expect(registry.updateStreamMetadata(streamId0, metadata0))
                .to.be.revertedWith("error_streamDoesNotExist")
        })

        it("FAILS if stream does not exist, or no delete permission", async (): Promise<void> => {
            await registry.createStream(streamPath0, metadata0)
            await expect(registry.deleteStream("0x00"))
                .to.be.revertedWith("error_streamDoesNotExist")
            await expect(registryFromUser0.deleteStream(streamId0))
                .to.be.revertedWith("error_noDeletePermission")
        })
    })

    describe("Permissions getters", () => {
        it("positivetest getDirectPermissionForUser", async (): Promise<void> => {
            expect(await registry.getDirectPermissionsForUser(streamId0, adminAddress))
                .to.deep.equal([true, true, MAX_INT, MAX_INT, true])
        })

        it("positivetest getPermissionForUser", async (): Promise<void> => {
            expect(await registry.getPermissionsForUser(streamId0, adminAddress))
                .to.deep.equal([true, true, MAX_INT, MAX_INT, true])
        })

        it("getPermissionForUser FAILS if stream not exist, or userentry not exist", async (): Promise<void> => {
            await expect(registry.getPermissionsForUser("0x00", adminAddress))
                .to.be.revertedWith("error_streamDoesNotExist")
            const res = await registry.getPermissionsForUser(streamId0, user0Address)
            expect(res.toString()).to.equal([false, false, ZERO, ZERO, false].toString())
        })

        it("FAILS for non-existing streams", async (): Promise<void> => {
            await expect(registry.getPermissionsForUser("0x0", adminAddress))
                .to.be.revertedWith("error_streamDoesNotExist")
        })
    })

    describe("Signer-user permissions setters", () => {

        it("positivetest setPermissionForUser", async (): Promise<void> => {
            const streamId = await createStream()
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
            // grant him all permissions
            let blockTime = BigNumber.from(await getBlocktime()).add(1)
            await expect(await registry.setPermissionsForUser(streamId, user0Address, true, true, blockTime, blockTime, true))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, true, true, blockTime, blockTime, true)
            expect((await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([true, true, blockTime, blockTime, true].toString())
            // test if he can edit streammetadata
            await registryFromUser0.updateStreamMetadata(streamId, metadata1)
            expect(await registryFromUser0.getStreamMetadata(streamId)).to.equal(metadata1)
            blockTime = blockTime.add(1)
            // test if he can share, edit other permissions
            await expect(await registryFromUser0.setPermissionsForUser(streamId, user1Address, true, true, blockTime, blockTime, true))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user1Address, true, true, blockTime, blockTime, true)
            expect((await registry.getPermissionsForUser(streamId, user1Address)).toString())
                .to.equal([true, true, blockTime, blockTime, true].toString())
            // test if he can delete stream
            await registryFromUser0.deleteStream(streamId)
            await expect(registry.getStreamMetadata(streamId))
                .to.be.revertedWith("error_streamDoesNotExist")
        })

        it("setPermissionForUser FAILS for non-existent stream or if no GRANT permission", async (): Promise<void> => {
            const streamPath = "/test-" + Date.now()
            const streamId = adminAddress.toLowerCase() + streamPath
            await expect(registry.getPermissionsForUser(streamId, adminAddress))
                .to.be.revertedWith("error_streamDoesNotExist")
            await expect(registryFromUser0.setPermissionsForUser(streamId, user0Address, true, true, 0, 0, true))
                .to.be.revertedWith("error_streamDoesNotExist")

            await registry.createStream(streamPath, metadata0)
            await expect(registryFromUser0.setPermissionsForUser(streamId, user0Address, true, true, 0, 0, true))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("positivetest grantPermission, hasPermission", async (): Promise<void> => {
            const streamId = await createStream()

            await expect(await registry.grantPermission(streamId, user0Address, PermissionType.Edit))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, true, false, ZERO, ZERO, false)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Edit))
                .to.equal(true)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([true, false, ZERO, ZERO, false].toString())

            await expect(await registry.grantPermission(streamId, user0Address, PermissionType.Delete))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, true, true, ZERO, ZERO, false)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Delete))
                .to.equal(true)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([true, true, ZERO, ZERO, false].toString())

            await expect(await registry.grantPermission(streamId, user0Address, PermissionType.Publish))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, true, true, MAX_INT, ZERO, false)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Publish))
                .to.equal(true)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString)
                .to.deep.equal([true, true, MAX_INT, ZERO, false].toString)

            await expect(await registry.grantPermission(streamId, user0Address, PermissionType.Subscribe))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, true, true, MAX_INT, MAX_INT, false)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Subscribe))
                .to.equal(true)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([true, true, MAX_INT, MAX_INT, false].toString())

            await expect(await registry.grantPermission(streamId, user0Address, PermissionType.Share))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, true, true, MAX_INT, MAX_INT, true)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Share))
                .to.equal(true)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([true, true, MAX_INT, MAX_INT, true].toString())
        })

        it("negativetest grantPermission", async (): Promise<void> => {
            // test from user1, who has no share permissions
            await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Edit))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Delete))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Publish))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Subscribe))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Share))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("positivetest revokePermission, hasPermission", async (): Promise<void> => {
            const streamId = await createStream()
            await registry.setPermissionsForUser(streamId, user0Address, true, true, MAX_INT, MAX_INT, true)

            await expect(await registry.revokePermission(streamId, user0Address, PermissionType.Edit))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, false, true, MAX_INT, MAX_INT, true)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Edit))
                .to.equal(false)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([false, true, MAX_INT, MAX_INT, true].toString())

            await expect(await registry.revokePermission(streamId, user0Address, PermissionType.Delete))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, false, false, MAX_INT, MAX_INT, true)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Delete))
                .to.equal(false)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([false, false, MAX_INT, MAX_INT, true].toString())

            await expect(await registry.revokePermission(streamId, user0Address, PermissionType.Publish))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, false, false, ZERO, MAX_INT, true)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Publish))
                .to.equal(false)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([false, false, ZERO, MAX_INT, true].toString())

            await expect(await registry.revokePermission(streamId, user0Address, PermissionType.Subscribe))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, false, false, ZERO, ZERO, true)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Subscribe))
                .to.equal(false)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, true].toString())

            await expect(await registry.revokePermission(streamId, user0Address, PermissionType.Share))
                .to.emit(registry, "PermissionUpdated")
                .withArgs(streamId, user0Address, false, false, ZERO, ZERO, false)
            expect(await registry.hasPermission(streamId, user0Address, PermissionType.Share))
                .to.equal(false)
            expect(await (await registry.getPermissionsForUser(streamId, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
        })

        it("negativetest grantPermission", async (): Promise<void> => {
            // test from user0, all his permissions were revoked in test before
            await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Edit))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Delete))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Publish))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Subscribe))
                .to.be.revertedWith("error_noSharePermission")
            await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Share))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("positivetest revokeAllPermissionsForUser, hasPermission", async (): Promise<void> => {
            blocktime = await getBlocktime()
            await registry.setPermissionsForUser(streamId0, user0Address, true, true, blocktime, blocktime, true)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true].toString())
            await registry.revokeAllPermissionsForUser(streamId0, user0Address)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
        })

        it("negativetest revokeAllPermissionsForUser", async (): Promise<void> => {
            await registry.revokePermission(streamId0, user0Address, PermissionType.Share)
            expect(await registry.hasPermission(streamId0, user0Address, PermissionType.Share))
                .to.equal(false)
            await expect(registryFromUser0.revokeAllPermissionsForUser(streamId0, user1Address))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("positivetest setPermissions", async (): Promise<void> => {
            const userA = ethers.Wallet.createRandom().address
            const userB = ethers.Wallet.createRandom().address
            const permissionA = {
                canEdit: true,
                canDelete: false,
                publishExpiration: MAX_INT,
                subscribeExpiration: MAX_INT,
                canGrant: false
            }
            const permissionB = {
                canEdit: false,
                canDelete: true,
                publishExpiration: 1,
                subscribeExpiration: 1,
                canGrant: true
            }

            await registry.setPermissions(streamId0, [userA, userB], [permissionA, permissionB])
            expect(await (await registry.getDirectPermissionsForUser(streamId0, userA)).toString()).to.equal(
                [true, false, MAX_INT, MAX_INT, false].toString()
            )
            expect(await (await registry.getDirectPermissionsForUser(streamId0, userB)).toString()).to.deep.equal(
                [false, true, BigNumber.from(1), BigNumber.from(1), true].toString()
            )
        })

        it("positivetest setPermissionsMultipleStreams", async (): Promise<void> => {
            const userA = ethers.Wallet.createRandom().address
            const userB = ethers.Wallet.createRandom().address
            await registry.createStream(streamPath2, metadata1)
            expect(await registry.getStreamMetadata(streamId2)).to.equal(metadata1)
            const permissionA = {
                canEdit: true,
                canDelete: false,
                publishExpiration: MAX_INT,
                subscribeExpiration: MAX_INT,
                canGrant: false
            }
            const permissionB = {
                canEdit: false,
                canDelete: true,
                publishExpiration: 1,
                subscribeExpiration: 1,
                canGrant: true
            }

            await registry.setPermissionsMultipleStreams([streamId0, streamId2],
                [[userA, userB], [userA, userB]], [[permissionA, permissionB], [permissionA, permissionB]])
            expect((await registry.getDirectPermissionsForUser(streamId0, userA)).toString()).to.deep.equal(
                [true, false, MAX_INT, MAX_INT, false].toString()
            )
            expect((await registry.getDirectPermissionsForUser(streamId0, userB)).toString()).to.deep.equal(
                [false, true, BigNumber.from(1), BigNumber.from(1), true].toString()
            )
            expect((await registry.getDirectPermissionsForUser(streamId2, userA)).toString()).to.deep.equal(
                [true, false, MAX_INT, MAX_INT, false].toString()
            )
            expect((await registry.getDirectPermissionsForUser(streamId2, userB)).toString()).to.deep.equal(
                [false, true, BigNumber.from(1), BigNumber.from(1), true].toString()
            )
        })

        it("positivetest setExpirationTime", async (): Promise<void> => {
            const date = BigNumber.from(Date.now()).div(1000).add(10000)
            await registry.setPermissionsForUser(streamId1, user0Address, true, true, MAX_INT, MAX_INT, true)
            await expect(registry.setExpirationTime(streamId1, user0Address, PermissionType.Publish, date))
                .to.emit(registry, "PermissionUpdated").withArgs(streamId1, user0Address, true, true, date, MAX_INT, true)
            expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
                .to.equal([true, true, date, MAX_INT, true].toString())
            await expect(registry.setExpirationTime(streamId1, user0Address, PermissionType.Subscribe, date))
                .to.emit(registry, "PermissionUpdated").withArgs(streamId1, user0Address, true, true, date, date, true)
            expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
                .to.equal([true, true, date, date, true].toString())
        })

        it("negativetest setExpirationTime", async (): Promise<void> => {
            await expect(registry.setExpirationTime(streamId1, user0Address, PermissionType.Edit, 7))
                .to.be.revertedWith("error_timeOnlyObPubSub")
            await expect(registry.setExpirationTime(streamId1, user0Address, PermissionType.Delete, 7))
                .to.be.revertedWith("error_timeOnlyObPubSub")
            await expect(registry.setExpirationTime(streamId1, user0Address, PermissionType.Share, 7))
                .to.be.revertedWith("error_timeOnlyObPubSub")
        })

        it("positivetest revoke own permissions without share", async (): Promise<void> => {
            await registry.setPermissionsForUser(streamId1, user0Address, true, true,
                MAX_INT, MAX_INT, false)
            await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Edit)
            expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
                .to.equal([false, true, MAX_INT, MAX_INT, false].toString())
            await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Delete)
            expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
                .to.equal([false, false, MAX_INT, MAX_INT, false].toString())
            await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Publish)
            expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
                .to.equal([false, false, ZERO, MAX_INT, false].toString())
            await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Subscribe)
            expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
        })

        it("negativetest revokeAllPermissionsForUser", async (): Promise<void> => {
            await registry.setPermissionsForUser(streamId1, user0Address,
                true, true, MAX_INT, MAX_INT, false)
            await registryFromUser0.revokeAllPermissionsForUser(streamId1, user0Address)
            expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
        })

        it("edgecases expirationtime", async (): Promise<void> => {
            blocktime = await getBlocktime() + 1
            await registry.setPermissionsForUser(streamId1, user0Address, true, true, blocktime, blocktime, true)
            expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
                .to.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true].toString())
            expect(await registry.hasPermission(streamId1, user0Address, PermissionType.Publish))
                .to.equal(true)
            expect(await registry.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
                .to.equal(true)
            expect(await registry.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
                .to.equal(true)
            expect(await registry.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
                .to.equal(true)
            // setting it again will advance the blocktime and expire the rights
            await registry.setPermissionsForUser(streamId1, user0Address, true, true, blocktime, blocktime, true)
            expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
                .to.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true].toString())
            expect(await registry.hasPermission(streamId1, user0Address, PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
                .to.equal(false)
            expect(await registry.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
                .to.equal(false)
            // give public publish permission, check again
            await registry.setPublicPermission(streamId1, blocktime + 2, blocktime + 2)
            expect(await registry.hasPermission(streamId1, user0Address, PermissionType.Publish))
                .to.equal(true)
            expect(await registry.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
                .to.equal(true)
            expect(await registry.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
                .to.equal(false)
            // setting it again (one more transaction) with the same number will advance the blocktime and expire the rights
            await registry.setPublicPermission(streamId1, blocktime + 2, blocktime + 2)
            expect(await registry.hasPermission(streamId1, user0Address, PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
                .to.equal(false)
            expect(await registry.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
                .to.equal(false)
            expect(await registry.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
                .to.equal(false)
        })
    })

    describe("Bytes-id user permissions", () => {
        it("grantPermissionForUserId happy path", async (): Promise<void> => {
            const streamId = await createStream()
            await expect(registry.grantPermissionForUserId(streamId, userBytesId, PermissionType.Publish))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, userBytesId, false, false, MAX_INT, ZERO, false)
            expect(await registry.getPermissionsForUserId(streamId, userBytesId))
                .to.deep.equal([false, false, MAX_INT, ZERO, false])
            expect(await registry.getDirectPermissionsForUserId(streamId, userBytesId))
                .to.deep.equal([false, false, MAX_INT, ZERO, false])
        })

        it("revokePermissionForUserId happy path", async (): Promise<void> => {
            const streamId = await createStream()
            await (await registry.grantPermissionForUserId(streamId, userBytesId, PermissionType.Subscribe)).wait()
            await expect(registry.revokePermissionForUserId(streamId, userBytesId, PermissionType.Publish))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, userBytesId, false, false, ZERO, MAX_INT, false)
            await expect(registry.revokePermissionForUserId(streamId, userBytesId, PermissionType.Subscribe))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, userBytesId, false, false, ZERO, ZERO, false)
            expect(await registry.getPermissionsForUserId(streamId, userBytesId))
                .to.deep.equal([false, false, ZERO, ZERO, false])
        })

        it("revokeAllPermissionsForUserId happy path", async (): Promise<void> => {
            const streamId = await createStream()
            await (await registry.grantPermissionForUserId(streamId, userBytesId, PermissionType.Publish)).wait()
            await (await registry.grantPermissionForUserId(streamId, userBytesId, PermissionType.Subscribe)).wait()
            await expect(registry.revokeAllPermissionsForUserId(streamId, userBytesId))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, userBytesId, false, false, ZERO, ZERO, false)
            expect(await registry.getPermissionsForUserId(streamId, userBytesId))
                .to.deep.equal([false, false, ZERO, ZERO, false])
        })

        it("setExpirationTimeForUserId happy path", async (): Promise<void> => {
            const streamId = await createStream()
            const date = BigNumber.from(Date.now()).div(1000).add(10000)
            await registry.setPermissionsForUserIds(streamId, [ userBytesId ], [ pubSubOnlyStruct ])
            await expect(registry.setExpirationTimeForUserId(streamId, userBytesId, PermissionType.Subscribe, date))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, userBytesId, false, false, MAX_INT, date, false)
            await expect(registry.setExpirationTimeForUserId(streamId, userBytesId, PermissionType.Publish, date))
                .to.emit(registry, "PermissionUpdatedForUserId")
                .withArgs(streamId, userBytesId, false, false, date, date, false)
        })

        // it("createStreamWithPermissionsForUserId happy path", async (): Promise<void> => {
        //     const streamPath = "/test-createStreamWithPermissionsForUserId-" + Date.now()
        //     const streamId = admin.address.toLowerCase() + streamPath
        //     await expect(registry.createStreamWithPermissionsForUserIds(streamPath, "{}", [userBytesId, userBytesId + "01"], [
        //         {...zeroPermissionStruct, subscribeExpiration: MAX_INT},
        //         {...zeroPermissionStruct, subscribeExpiration: MAX_INT, publishExpiration: MAX_INT}
        //     ])) .to.emit(registry, "StreamCreated").withArgs(streamId, "{}")
        //         .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, userBytesId, false, false, ZERO, MAX_INT, false)
        //         .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, userBytesId + "01", false, false, MAX_INT, MAX_INT, false)
        // })

        it("setMultipleStreamPermissionsForUserIds happy path", async (): Promise<void> => {
            const streamId = await createStream()
            const perms = { ...zeroPermissionStruct, subscribeExpiration: MAX_INT }
            await expect(registry.setMultipleStreamPermissionsForUserIds([streamId, streamId], [[userBytesId], [userBytesId]], [[perms], [perms]]))
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, userBytesId, false, false, ZERO, MAX_INT, false)
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, userBytesId, false, false, ZERO, MAX_INT, false)
        })

        it("setPermissionsForUserIds happy path", async (): Promise<void> => {
            const streamId = await createStream()
            await expect(registry.setPermissionsForUserIds(streamId, [ userBytesId ], [ allPermissionsStruct ]))
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, userBytesId, true, true, MAX_INT, MAX_INT, true)
            await expect(registry.setPermissionsForUserIds(streamId, [ userBytesId ], [ zeroPermissionStruct ]))
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, userBytesId, false, false, 0, 0, false)
            await expect(registry.setPermissionsForUserIds(streamId, [ userBytesId ], [ pubSubOnlyStruct ]))
                .to.emit(registry, "PermissionUpdatedForUserId").withArgs(streamId, userBytesId, false, false, MAX_INT, MAX_INT, false)
        })

        it("setExpirationTimeForUserId FAILS for non-existent stream / no grant permission", async (): Promise<void> => {
            await expect(registry.setExpirationTimeForUserId("0x00", userBytesId, PermissionType.Publish, MAX_INT))
                .to.be.revertedWith("error_streamDoesNotExist")
            await expect(registry.connect(wallets[4]).setExpirationTimeForUserId(streamId1, userBytesId, PermissionType.Publish, MAX_INT))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("setPermissionsForUserIds FAILS for non-existent stream / no grant permission", async (): Promise<void> => {
            await expect(registry.setPermissionsForUserIds("0x00", [userBytesId], [zeroPermissionStruct]))
                .to.be.revertedWith("error_streamDoesNotExist")
            await expect(registry.connect(wallets[4]).setPermissionsForUserIds(streamId1, [userBytesId], [zeroPermissionStruct]))
                .to.be.revertedWith("error_noSharePermission")
        })

        it("setMultipleStreamPermissionsForUserIds FAILS for non-existent stream / no grantperm / arg-length mismatch", async (): Promise<void> => {
            const perms = { ...zeroPermissionStruct, subscribeExpiration: MAX_INT }
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId1, "0x00"],
                [[userBytesId], [userBytesId]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_streamDoesNotExist")
            await expect(registryFromUser1.setMultipleStreamPermissionsForUserIds(
                [streamId1, "0x00"],
                [[userBytesId], [userBytesId]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_noSharePermission")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId1],
                [[userBytesId], [userBytesId]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId1, streamId1],
                [[userBytesId]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId1, streamId1],
                [[userBytesId], [userBytesId]],
                [[perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId1, streamId1],
                [[userBytesId, userBytesId], [userBytesId]],
                [[perms], [perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
            await expect(registry.setMultipleStreamPermissionsForUserIds(
                [streamId1, streamId1],
                [[userBytesId], [userBytesId]],
                [[perms], [perms, perms]])
            ).to.be.revertedWith("error_invalidInputArrayLengths")
        })

        it("should work with addresses just like non-bytes-id functions", async (): Promise<void> => {
            const streamId = await createStream()
            expect(await registry.getPermissionsForUserId(streamId, user0Address)).to.deep.equal([false, false, ZERO, ZERO, false])
            await (await registry.grantPermission(streamId, user0Address, PermissionType.Publish)).wait()
            expect(await registry.getPermissionsForUserId(streamId, user0Address)).to.deep.equal([false, false, MAX_INT, ZERO, false])
            await (await registry.revokeAllPermissionsForUserId(streamId, user0Address)).wait()
            expect(await registry.getPermissionsForUser(streamId, user0Address)).to.deep.equal([false, false, ZERO, ZERO, false])
            await (await registry.grantPermissionForUserId(streamId, user0Address, PermissionType.Subscribe)).wait()
            expect(await registry.getPermissionsForUser(streamId, user0Address)).to.deep.equal([false, false, ZERO, MAX_INT, false])
            await (await registry.revokeAllPermissionsForUser(streamId, user0Address)).wait()
            expect(await registry.getPermissionsForUserId(streamId, user0Address)).to.deep.equal([false, false, ZERO, ZERO, false])
        })
    })

    describe("Public permissions", () => {
        it("positivetest grantPublicPermission", async (): Promise<void> => {
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
            await registry.grantPublicPermission(streamId0, PermissionType.Publish)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, MAX_INT, ZERO, false].toString())
            await registry.grantPublicPermission(streamId0, PermissionType.Subscribe)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, MAX_INT, MAX_INT, false].toString())
            expect(await registry.hasPublicPermission(streamId0, PermissionType.Publish)).to.equal(true)
            expect(await registry.hasPublicPermission(streamId0, PermissionType.Subscribe)).to.equal(true)
            expect(await registry.hasPublicPermission(streamId0, PermissionType.Edit)).to.equal(false)
            expect(await registry.hasPublicPermission(streamId0, PermissionType.Delete)).to.equal(false)
            expect(await registry.hasPublicPermission(streamId0, PermissionType.Share)).to.equal(false)
        })

        it("negativetest grantPublicPermission", async (): Promise<void> => {
            await expect(registry.grantPublicPermission(streamId0, PermissionType.Edit))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.grantPublicPermission(streamId0, PermissionType.Delete))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.grantPublicPermission(streamId0, PermissionType.Share))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("FAILS if setting improper public permissions using setPermissionsForUser", async (): Promise<void> => {
            await expect(registry.setPermissionsForUser(streamId0, AddressZero, true, false, 0, 0, false))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.setPermissionsForUser(streamId0, AddressZero, false, true, 0, 0, false))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.setPermissionsForUser(streamId0, AddressZero, false, false, 0, 0, true))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("positivetest revokePublicPermission", async (): Promise<void> => {
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, MAX_INT, MAX_INT, false].toString())
            await registry.revokePublicPermission(streamId0, PermissionType.Publish)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, ZERO, MAX_INT, false].toString())
            await registry.revokePublicPermission(streamId0, PermissionType.Subscribe)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
        })

        it("negativetest revokePublicPermission", async (): Promise<void> => {
            await expect(registry.revokePublicPermission(streamId0, PermissionType.Edit))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.revokePublicPermission(streamId0, PermissionType.Delete))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
            await expect(registry.revokePublicPermission(streamId0, PermissionType.Share))
                .to.be.revertedWith("error_publicCanOnlySubsPubl")
        })

        it("positivetest setPublicPermission", async (): Promise<void> => {
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
            await registry.setPublicPermission(streamId0, MAX_INT, MAX_INT)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, MAX_INT, MAX_INT, false].toString())
            blocktime = await getBlocktime() + 1
            await registry.setPublicPermission(streamId0, blocktime, blocktime)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, BigNumber.from(blocktime), BigNumber.from(blocktime), false].toString())
            await registry.setPublicPermission(streamId0, 0, 0)
            expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
                .to.equal([false, false, ZERO, ZERO, false].toString())
        })
    })

    describe("EIP-2771 meta-transactions feature", () => {
        async function getCreateStreamMetaTx({
            forwarder = minimalForwarderFromUser0,
            signer = ethers.Wallet.createRandom(),
            gas
        }: { forwarder?: MinimalForwarder; signer?: typeof Wallet; gas?: string } = {}) {
            // signerWallet is creating and signing transaction, user0 is posting it and paying for gas
            // in the positive case signkey is the same as signerWallet.privateKey
            const path = "/path" + Wallet.createRandom().address
            const metadata = "metadata"
            const data = await registry.interface.encodeFunctionData("createStream", [path, metadata])
            const { request, signature } = await getEIP2771MetaTx(registry.address, data, forwarder, signer, gas)
            return { request, signature, path, metadata, signer }
        }

        it("works as expected (happy path)", async (): Promise<void> => {
            const { request, signature, path, metadata, signer } = await getCreateStreamMetaTx()
            const signatureIsValid = await minimalForwarderFromUser0.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            const receipt = await (await minimalForwarderFromUser0.execute(request, signature)).wait()
            expect(receipt.logs.length).to.equal(2)
            const id = signer.address.toLowerCase() + path
            expect(await registry.getStreamMetadata(id)).to.equal(metadata)
        })

        it("FAILS with wrong forwarder (negativetest)", async (): Promise<void> => {
            log("Deploy second minimal forwarder")
            const minimalForwarderFromUser0Factory = await ethers.getContractFactory("MinimalForwarder", wallets[9])
            const wrongForwarder = await minimalForwarderFromUser0Factory.deploy() as MinimalForwarder
            await wrongForwarder.deployed()

            log("Check that the correct forwarder is set")
            expect(await registry.isTrustedForwarder(minimalForwarderFromUser0.address)).to.be.true
            expect(await registry.isTrustedForwarder(wrongForwarder.address)).to.be.false

            log("Metatx seems to succeed with the wrong forwarder")
            const { request, signature, path, signer } = await getCreateStreamMetaTx({ forwarder: wrongForwarder })
            const signatureIsValid = await wrongForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            const receipt = await (await wrongForwarder.execute(request, signature)).wait()
            expect(receipt.logs.length).to.equal(2)

            log("Tx failed, so stream wasn't created")
            const id = signer.address.toLowerCase() + path
            await expect(registry.getStreamMetadata(id)).to.be.revertedWith("error_streamDoesNotExist")
        })

        it("FAILS with wrong signature (negativetest)", async (): Promise<void> => {
            const wrongSigner = ethers.Wallet.createRandom()
            const { request } = await getCreateStreamMetaTx()
            const { signature } = await getCreateStreamMetaTx({ signer: wrongSigner })
            const signatureIsValid = await minimalForwarderFromUser0.verify(request, signature)
            await expect(signatureIsValid).to.be.false
            await expect(minimalForwarderFromUser0.execute(request, signature))
                .to.be.revertedWith("MinimalForwarder: signature does not match request")
        })

        it("FAILS with not enough gas in internal transaction call (negativetest)", async (): Promise<void> => {
            log("Create a valid signature with too little gas for the tx")
            const { request, signature, path } = await getCreateStreamMetaTx({ gas: "1000" })
            const signatureIsValid = await minimalForwarderFromUser0.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            const receipt = await (await minimalForwarderFromUser0.execute(request, signature)).wait()
            expect(receipt.logs.length).to.equal(0)

            log("Tx failed, so stream wasn't created")
            const id = adminAddress.toLowerCase() + path
            await expect(registry.getStreamMetadata(id))
                .to.be.revertedWith("error_streamDoesNotExist")
        })

        it("works after resetting trusted forwarder (positivetest)", async (): Promise<void> => {
            log("Deploy second minimal forwarder")
            const minimalForwarderFromUser0Factory = await ethers.getContractFactory("MinimalForwarder", wallets[9])
            const newForwarder = await minimalForwarderFromUser0Factory.deploy() as MinimalForwarder
            await newForwarder.deployed()

            log("Set new forwarder")
            await registry.grantRole(await registry.TRUSTED_ROLE(), wallets[0].address)
            await registry.setTrustedForwarder(newForwarder.address)

            log("Check that the correct forwarder is set")
            expect(await registry.isTrustedForwarder(minimalForwarderFromUser0.address)).to.be.false
            expect(await registry.isTrustedForwarder(newForwarder.address)).to.be.true

            log("Check that metatx works with new forwarder")
            const { request, signature, path, metadata, signer } = await getCreateStreamMetaTx({ forwarder: newForwarder })
            const signatureIsValid = await newForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            const receipt = await (await newForwarder.execute(request, signature)).wait()
            expect(receipt.logs.length).to.equal(2)
            const id = signer.address.toLowerCase() + path
            expect(await registry.getStreamMetadata(id)).to.equal(metadata)

            log("Set old forwarder back")
            await registry.setTrustedForwarder(minimalForwarderFromUser0.address)
            await registry.revokeRole(await registry.TRUSTED_ROLE(), wallets[0].address)
        })

        it("recognizes the trusted forwarder (positivetest)", async (): Promise<void> => {
            expect(await registry.isTrustedForwarder(minimalForwarderFromUser0.address))
                .to.equal(true)
        })

        it("PREVENTS resetting trusted forwarder if caller not trusted (negativetest)", async (): Promise<void> => {
            await expect(registryFromUser0.setTrustedForwarder(Wallet.createRandom().address))
                .to.be.revertedWith("error_mustBeTrustedRole")
        })
    })
})
