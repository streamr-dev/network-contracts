import { upgrades, ethers } from "hardhat"
import { expect } from "chai"
import Debug from "debug"

import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import { getEIP2771MetaTx } from "./getEIP2771MetaTx"
import type { MinimalForwarder, StreamRegistry, StreamRegistryV4 } from "../../../typechain"

const log = Debug("Streamr::test::StreamRegistryV4")

const { Wallet, BigNumber } = ethers

// eslint-disable-next-line no-unused-vars
enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Share }

const getBlocktime = async (): Promise<number> => {
    const blocknumber = await ethers.provider.getBlockNumber()
    const block = await ethers.provider.getBlock(blocknumber)
    return block.timestamp
}

describe("StreamRegistry", async (): Promise<void> => {
    let wallets: SignerWithAddress[]
    // let ensCacheFromAdmin: ENSCache
    let registry: StreamRegistryV4
    let registryFromAdmin: StreamRegistryV4
    let registryFromUser0: StreamRegistryV4
    let registryFromUser1: StreamRegistryV4
    let registryFromMigrator: StreamRegistryV4
    let minimalForwarderFromUser0: MinimalForwarder
    let MAX_INT: any
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

    before(async (): Promise<void> => {
        wallets = await ethers.getSigners()
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
        const streamRegistryFactoryV2Tx = await upgrades.deployProxy(streamRegistryFactoryV2,
            ["0x0000000000000000000000000000000000000000", minimalForwarderFromUser0.address], {
                kind: "uups"
            })
        const registryV2FromAdmin = await streamRegistryFactoryV2Tx.deployed() as StreamRegistryV4
        // to upgrade the deployer must also have the trusted role
        // we will grant it and revoke it after the upgrade to keep admin and trusted roles separate
        await registryV2FromAdmin.grantRole(await registryV2FromAdmin.TRUSTED_ROLE(), wallets[0].address)
        const streamregistryFactoryV3 = await ethers.getContractFactory("StreamRegistryV3", wallets[0])
        const streamRegistryFactoryV3Tx = await upgrades.upgradeProxy(streamRegistryFactoryV2Tx.address,
            streamregistryFactoryV3)
        await streamRegistryFactoryV3Tx.deployed() as StreamRegistry
        //also upgrade the registry to V4
        const streamregistryFactoryV4 = await ethers.getContractFactory("StreamRegistryV4_1", wallets[0])
        const streamRegistryFactoryV4Tx = await upgrades.upgradeProxy(streamRegistryFactoryV3Tx.address,
            streamregistryFactoryV4)
        await registryV2FromAdmin.revokeRole(await registryV2FromAdmin.TRUSTED_ROLE(), wallets[0].address)
        // eslint-disable-next-line require-atomic-updates
        registry = await streamRegistryFactoryV4Tx.deployed() as StreamRegistryV4
        registryFromAdmin = registry.connect(wallets[0] as any)
        registryFromUser0 = registry.connect(wallets[1] as any)
        registryFromUser1 = registry.connect(wallets[2] as any)
        registryFromMigrator = registry.connect(wallets[3] as any)
        MAX_INT = await registry.MAX_INT()
        await registryFromAdmin.grantRole(await registry.TRUSTED_ROLE(), trustedAddress)
    })

    it("positivetest createStream + event, get description", async (): Promise<void> => {
        await expect(await registryFromAdmin.createStream(streamPath0, metadata0))
            .to.emit(registryFromAdmin, "StreamCreated")
            .withArgs(streamId0, metadata0)
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, adminAddress, true, true, MAX_INT, MAX_INT, true)
        expect(await registryFromAdmin.streamIdToMetadata(streamId0)).to.equal(metadata0)
    })

    it("positivetest createStream path character edgecases", async (): Promise<void> => {
        expect(await registryFromAdmin.createStream("/", metadata0))
            .to.not.throw
        expect(await registryFromAdmin.createStream("/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./_-", metadata0))
            .to.not.throw
    })

    it("negativetest createStream path character edgecases", async (): Promise<void> => {
        await expect(registryFromAdmin.createStream("/,", metadata0))
            .to.be.revertedWith("error_invalidPathChars")
        await expect(registryFromAdmin.createStream("/:", metadata0))
            .to.be.revertedWith("error_invalidPathChars")
        await expect(registryFromAdmin.createStream("/@", metadata0))
            .to.be.revertedWith("error_invalidPathChars")
        await expect(registryFromAdmin.createStream("/[", metadata0))
            .to.be.revertedWith("error_invalidPathChars")
        await expect(registryFromAdmin.createStream("/`", metadata0))
            .to.be.revertedWith("error_invalidPathChars")
        await expect(registryFromAdmin.createStream("/{", metadata0))
            .to.be.revertedWith("error_invalidPathChars")
    })

    it("negativetest createStream, already exists error", async (): Promise<void> => {
        await expect(registryFromAdmin.createStream(streamPath0, metadata0))
            .to.be.revertedWith("error_streamAlreadyExists")
    })

    it("negativetest createStream, path not starting with slash", async (): Promise<void> => {
        await expect(registryFromAdmin.createStream("pathWithoutSalsh", metadata0))
            .to.be.revertedWith("error_pathMustStartWithSlash")
    })

    it("positivetest getStreamMetadata", async (): Promise<void> => {
        expect(await registry.getStreamMetadata(streamId0)).to.equal(metadata0)
    })

    it("positivetest setEnsCache", async (): Promise<void> => {
        const role = await registry.TRUSTED_ROLE()
        const has = await registry.hasRole(role, trustedAddress)
        expect(has).to.equal(true)
        await registryFromMigrator.setEnsCache("0x0000000000000000000000000000000000000000")
    })

    it("negativetest getStreamMetadata, stream doesnt exist", async (): Promise<void> => {
        await expect(registry.getStreamMetadata(streamId1)).to.be.revertedWith("error_streamDoesNotExist")
    })

    it("positivetest updateStreamMetadata + event", async (): Promise<void> => {
        expect(await registry.getStreamMetadata(streamId0)).to.equal(metadata0)
        await expect(await registryFromAdmin.updateStreamMetadata(streamId0, metadata1))
            .to.emit(registryFromAdmin, "StreamUpdated")
            .withArgs(streamId0, metadata1)
        expect(await registry.getStreamMetadata(streamId0)).to.equal(metadata1)
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
        await expect(await registryFromAdmin.createStreamWithPermissions(newStreamPath, metadata1,
            [adminAddress, trustedAddress], [permissionA, permissionB]))
            // [trustedAddress], [permissionB]))
            .to.emit(registryFromAdmin, "StreamCreated")
            .withArgs(newStreamId, metadata1)
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(newStreamId, adminAddress, true, true, MAX_INT, MAX_INT, true)
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(newStreamId, adminAddress, true, false, MAX_INT, MAX_INT, true)
            .to.emit(registryFromAdmin, "PermissionUpdated")
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
        await expect(await registryFromAdmin.createMultipleStreamsWithPermissions(
            [newStreamPath1, newStreamPath2], [metadata1, metadata1], [[adminAddress, trustedAddress],
                [adminAddress, trustedAddress]], [[permissionA, permissionB], [permissionA, permissionB]]))
            .to.emit(registryFromAdmin, "StreamCreated")
            .withArgs(newStreamId1, metadata1)
            .to.emit(registryFromAdmin, "StreamCreated")
            .withArgs(newStreamId2, metadata1)
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(newStreamId1, adminAddress, true, true, MAX_INT, MAX_INT, true)
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(newStreamId2, adminAddress, true, true, MAX_INT, MAX_INT, true)
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(newStreamId1, adminAddress, true, false, MAX_INT, MAX_INT, true)
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(newStreamId2, adminAddress, true, false, MAX_INT, MAX_INT, true)
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(newStreamId1, trustedAddress, false, false, 7, 7, false)
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(newStreamId2, trustedAddress, false, false, 7, 7, false)
        expect(await registry.getStreamMetadata(newStreamId1)).to.equal(metadata1)
        expect(await registry.getStreamMetadata(newStreamId2)).to.equal(metadata1)
    })

    it("negativetest updateStreamMetadata, not exist, no right", async (): Promise<void> => {
        await expect(registryFromAdmin.updateStreamMetadata(streamId1, metadata0))
            .to.be.revertedWith("error_streamDoesNotExist")
        await expect(registryFromUser0.updateStreamMetadata(streamId0, metadata0))
            .to.be.revertedWith("error_noEditPermission")
    })

    it("positivetest deleteStream + event", async (): Promise<void> => {
        expect(await registry.getStreamMetadata(streamId0)).to.equal(metadata1)
        await expect(await registryFromAdmin.deleteStream(streamId0))
            .to.emit(registryFromAdmin, "StreamDeleted")
            .withArgs(streamId0)
        await expect(registryFromAdmin.updateStreamMetadata(streamId0, metadata0))
            .to.be.revertedWith("error_streamDoesNotExist")
    })

    it("negativetest deleteStream, not exist, no right", async (): Promise<void> => {
        await registryFromAdmin.createStream(streamPath0, metadata0)
        await expect(registryFromAdmin.deleteStream(streamId1))
            .to.be.revertedWith("error_streamDoesNotExist")
        await expect(registryFromUser0.deleteStream(streamId0))
            .to.be.revertedWith("error_noDeletePermission")
    })

    it("positivetest getDirectPermissionForUser", async (): Promise<void> => {
        expect(await registry.getDirectPermissionsForUser(streamId0, adminAddress))
            .to.deep.equal([true, true, MAX_INT, MAX_INT, true])
    })

    it("positivetest getPermissionForUser", async (): Promise<void> => {
        expect(await registry.getPermissionsForUser(streamId0, adminAddress))
            .to.deep.equal([true, true, MAX_INT, MAX_INT, true])
    })

    it("negativetest getPermissionForUser, stream not exist, userentry not exist", async (): Promise<void> => {
        await expect(registry.getPermissionsForUser(streamId1, adminAddress))
            .to.be.revertedWith("error_streamDoesNotExist")
        const res = await registry.getPermissionsForUser(streamId0, user0Address)
        expect(res.toString()).to.equal([false, false, BigNumber.from(0), BigNumber.from(0),
            false].toString())
    })

    it("positivetest setPermissionForUser", async (): Promise<void> => {
        // user0 has no permissions on stream0
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        // grant him all permissions
        blocktime = await getBlocktime() + 1
        await expect(await registryFromAdmin.setPermissionsForUser(streamId0, user0Address,
            true, true, blocktime, blocktime, true))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true].toString())
        // test if he can edit streammetadata
        expect(await registryFromUser0.getStreamMetadata(streamId0)).to.equal(metadata0)
        await registryFromUser0.updateStreamMetadata(streamId0, metadata1)
        expect(await registryFromUser0.getStreamMetadata(streamId0)).to.equal(metadata1)
        blocktime += 1
        // test if he can share, edit other permissions
        await expect(await registryFromUser0.setPermissionsForUser(streamId0, user1Address,
            true, true, blocktime, blocktime, true))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user1Address, true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true)
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true].toString())
        // test if he can delete stream
        await registryFromUser0.deleteStream(streamId0)
        await expect(registry.getStreamMetadata(streamId0))
            .to.be.revertedWith("error_streamDoesNotExist")
    })

    it("negativetest setPermissionForUser, stream doesnt exist, error_noSharePermission", async (): Promise<void> => {
        await expect(registry.getPermissionsForUser(streamId0, adminAddress))
            .to.be.revertedWith("error_streamDoesNotExist")
        await registryFromAdmin.createStream(streamPath0, metadata0)
        await expect(registryFromUser0.setPermissionsForUser(streamId0, user0Address, true, true, 0, 0, true))
            .to.be.revertedWith("error_noSharePermission")
    })

    it("positivetest grantPermission, hasPermission", async (): Promise<void> => {
        // user0 has no permissions on stream0
        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Edit))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, true, false, BigNumber.from(0), BigNumber.from(0), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Edit))
            .to.equal(true)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, false, BigNumber.from(0), BigNumber.from(0), false].toString())

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Delete))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(0), BigNumber.from(0), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Delete))
            .to.equal(true)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(0), BigNumber.from(0), false].toString())

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Publish))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(MAX_INT), BigNumber.from(0), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString)
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(0), false].toString)

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString())

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Share))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Share))
            .to.equal(true)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
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
        // user0 has no permissions on stream0
        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Edit))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, false, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Edit))
            .to.equal(false)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Delete))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Delete))
            .to.equal(false)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Publish))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, false, false, BigNumber.from(0), BigNumber.from(MAX_INT), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(MAX_INT), true].toString())

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, false, false, BigNumber.from(0), BigNumber.from(0), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), true].toString())

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Share))
            .to.emit(registryFromAdmin, "PermissionUpdated")
            .withArgs(streamId0, user0Address, false, false, BigNumber.from(0), BigNumber.from(0), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Share))
            .to.equal(false)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
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
        await registryFromAdmin.setPermissionsForUser(streamId0, user0Address, true, true, blocktime, blocktime, true)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true].toString())
        await registryFromAdmin.revokeAllPermissionsForUser(streamId0, user0Address)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
    })

    it("negativetest revokeAllPermissionsForUser", async (): Promise<void> => {
        await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Share)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Share))
            .to.equal(false)
        await expect(registryFromUser0.revokeAllPermissionsForUser(streamId0, user1Address))
            .to.be.revertedWith("error_noSharePermission")
    })

    // test if create stream->delete stream->recreate stream with same id also wipes
    // all permissions (not trivial since you can't delete mappings)
    it("recreate stream with same id wipes permissions", async (): Promise<void> => {
        await registryFromAdmin.deleteStream(streamId0)
        await registryFromAdmin.createStream(streamPath0, metadata0)
        // give user0 all permissions
        await registryFromAdmin.setPermissionsForUser(streamId0, user0Address,
            true, true, MAX_INT, MAX_INT, true)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
        // delete stream, and recreate with same id
        await registryFromAdmin.deleteStream(streamId0)
        await registryFromAdmin.createStream(streamPath0, metadata0)
        // check that user0 has no permission
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
    })

    it("positivetest grantPublicPermission", async (): Promise<void> => {
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        await registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Publish)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(0), false].toString())
        await registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Subscribe)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString())
        expect(await registry.hasPublicPermission(streamId0, PermissionType.Publish)).to.equal(true)
        expect(await registry.hasPublicPermission(streamId0, PermissionType.Subscribe)).to.equal(true)
        expect(await registry.hasPublicPermission(streamId0, PermissionType.Edit)).to.equal(false)
        expect(await registry.hasPublicPermission(streamId0, PermissionType.Delete)).to.equal(false)
        expect(await registry.hasPublicPermission(streamId0, PermissionType.Share)).to.equal(false)
    })

    it("negativetest grantPublicPermission", async (): Promise<void> => {
        await expect(registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Edit))
            .to.be.revertedWith("error_publicCanOnlySubsPubl")
        await expect(registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Delete))
            .to.be.revertedWith("error_publicCanOnlySubsPubl")
        await expect(registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Share))
            .to.be.revertedWith("error_publicCanOnlySubsPubl")
    })

    it("positivetest revokePublicPermission", async (): Promise<void> => {
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString())
        await registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Publish)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(MAX_INT), false].toString())
        await registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Subscribe)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
    })

    it("negativetest revokePublicPermission", async (): Promise<void> => {
        await expect(registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Edit))
            .to.be.revertedWith("error_publicCanOnlySubsPubl")
        await expect(registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Delete))
            .to.be.revertedWith("error_publicCanOnlySubsPubl")
        await expect(registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Share))
            .to.be.revertedWith("error_publicCanOnlySubsPubl")
    })

    it("positivetest setPublicPermission", async (): Promise<void> => {
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        await registryFromAdmin.setPublicPermission(streamId0, MAX_INT, MAX_INT)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString())
        blocktime = await getBlocktime() + 1
        await registryFromAdmin.setPublicPermission(streamId0, blocktime, blocktime)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(blocktime), BigNumber.from(blocktime), false].toString())
        await registryFromAdmin.setPublicPermission(streamId0, 0, 0)
        expect(await (await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
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

        await registryFromAdmin.setPermissions(streamId0, [userA, userB], [permissionA, permissionB])
        expect(await (await registry.getDirectPermissionsForUser(streamId0, userA)).toString()).to.equal(
            [true, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString()
        )
        expect(await (await registry.getDirectPermissionsForUser(streamId0, userB)).toString()).to.deep.equal(
            [false, true, BigNumber.from(1), BigNumber.from(1), true].toString()
        )
    })

    it("positivetest setPermissionsMultipleStreams", async (): Promise<void> => {
        const userA = ethers.Wallet.createRandom().address
        const userB = ethers.Wallet.createRandom().address
        await registryFromAdmin.createStream(streamPath2, metadata1)
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

        await registryFromAdmin.setPermissionsMultipleStreans([streamId0, streamId2],
            [[userA, userB], [userA, userB]], [[permissionA, permissionB], [permissionA, permissionB]])
        expect((await registry.getDirectPermissionsForUser(streamId0, userA)).toString()).to.deep.equal(
            [true, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString()
        )
        expect((await registry.getDirectPermissionsForUser(streamId0, userB)).toString()).to.deep.equal(
            [false, true, BigNumber.from(1), BigNumber.from(1), true].toString()
        )
        expect((await registry.getDirectPermissionsForUser(streamId2, userA)).toString()).to.deep.equal(
            [true, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString()
        )
        expect((await registry.getDirectPermissionsForUser(streamId2, userB)).toString()).to.deep.equal(
            [false, true, BigNumber.from(1), BigNumber.from(1), true].toString()
        )
    })

    // negativetest setPublicPermission is trivial, was tested in setPermissionsForUser negativetest
    it("positivetest trustedRoleSetStream", async (): Promise<void> => {
        expect((await registry.getPermissionsForUser(streamId0, trustedAddress)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        expect(await registry.getStreamMetadata(streamId0))
            .to.deep.equal(metadata0)
        await registryFromMigrator.trustedSetStreamMetadata(streamId0, metadata1)
        expect(await registry.getStreamMetadata(streamId0))
            .to.deep.equal(metadata1)
    })

    it("positivetest getTrustedRoleId", async (): Promise<void> => {
        expect(await registryFromAdmin.getTrustedRole()).to.equal("0x2de84d9fbdf6d06e2cc584295043dbd76046423b9f8bae9426d4fa5e7c03f4a7")
    })

    it("positivetest trustedRoleSetPermissionsForUser", async (): Promise<void> => {
        expect((await registry.getPermissionsForUser(streamId0, trustedAddress)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        await registryFromMigrator.trustedSetPermissionsForUser(streamId0, user0Address,
            true, true, MAX_INT, MAX_INT, true)
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
    })

    it("negativetest trustedSetStream", async (): Promise<void> => {
        await expect(registryFromAdmin.trustedSetStreamMetadata(streamId0, metadata1))
            .to.be.revertedWith("error_mustBeTrustedRole")
    })

    it("positivetest trustedSetStreamWithPermissions", async (): Promise<void> => {
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
        expect(await registry.getStreamMetadata(streamId0))
            .to.deep.equal(metadata1)
        await registryFromMigrator.trustedSetStreamWithPermission(streamId0, metadata0, user0Address, false, false, 0, 0, false)
        expect(await registry.getStreamMetadata(streamId0))
            .to.deep.equal(metadata0)
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        await registryFromMigrator.trustedSetStreamWithPermission(streamId0, metadata1, user0Address, true, true, MAX_INT, MAX_INT, true)
        expect(await registry.getStreamMetadata(streamId0))
            .to.deep.equal(metadata1)
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
    })

    it("negativetest trustedSetPermissionsForUser", async (): Promise<void> => {
        await expect(registryFromAdmin.trustedSetPermissionsForUser(streamId0,
            user0Address, true, true, MAX_INT, MAX_INT, true))
            .to.be.revertedWith("error_mustBeTrustedRole")
    })

    it("positivetest transferAllPermissionsToUser", async (): Promise<void> => {
        expect((await registry.getPermissionsForUser(streamId0, adminAddress)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        await registryFromAdmin.transferAllPermissionsToUser(streamId0, user1Address)
        expect((await registry.getPermissionsForUser(streamId0, adminAddress)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
            // make sure positive ones are not overwritten
            // user 0 and 1 both have all perms
        await registryFromUser0.setPermissionsForUser(streamId0, user0Address,
            true, false, 0, 0, false)
        // it also tests that user0 can transfer away even though he does not have share permission
        await registryFromUser0.transferAllPermissionsToUser(streamId0, user1Address)
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
    })

    it("negativetest transferAllPermissionsToUser", async (): Promise<void> => {
        await expect(registryFromUser0.transferAllPermissionsToUser(streamId0, user1Address))
            .to.be.revertedWith("error_noPermissionToTransfer")
    })

    it("positivetest transferPermissionToUser", async (): Promise<void> => {
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Edit)
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([false, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Delete)
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(0), BigNumber.from(0), false].toString())
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Publish)
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(MAX_INT), true].toString())
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(0), false].toString())
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Subscribe)
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), true].toString())
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString())
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Share)
        expect((await registry.getPermissionsForUser(streamId0, user1Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
        expect((await registry.getPermissionsForUser(streamId0, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true].toString())
    })

    it("negativetest transferPermissionToUser", async (): Promise<void> => {
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Edit))
            .to.be.revertedWith("error_noPermissionToTransfer")
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Delete))
            .to.be.revertedWith("error_noPermissionToTransfer")
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Publish))
            .to.be.revertedWith("error_noPermissionToTransfer")
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Subscribe))
            .to.be.revertedWith("error_noPermissionToTransfer")
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Share))
            .to.be.revertedWith("error_noPermissionToTransfer")
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
            const data = await registryFromAdmin.interface.encodeFunctionData("createStream", [path, metadata])
            const { request, signature } = await getEIP2771MetaTx(registryFromAdmin.address, data, forwarder, signer, gas)
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
            await registryFromAdmin.grantRole(await registry.TRUSTED_ROLE(), wallets[0].address)
            await registryFromAdmin.setTrustedForwarder(newForwarder.address)

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
            await registryFromAdmin.setTrustedForwarder(minimalForwarderFromUser0.address)
            await registryFromAdmin.revokeRole(await registry.TRUSTED_ROLE(), wallets[0].address)
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

    it("positivetest revoke own permissions without share", async (): Promise<void> => {
        await registryFromAdmin.createStream(streamPath1, metadata1)
        expect(await registry.getStreamMetadata(streamId1)).to.equal(metadata1)

        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address, true, true,
            MAX_INT, MAX_INT, false)
        await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Edit)
        expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
            .to.equal([false, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString())
        await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Delete)
        expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false].toString())
        await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Publish)
        expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(MAX_INT), false].toString())
        await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Subscribe)
        expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
    })

    it("negativetest revokeAllPermissionsForUser", async (): Promise<void> => {
        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address,
            true, true, MAX_INT, MAX_INT, false)
        await registryFromUser0.revokeAllPermissionsForUser(streamId1, user0Address)
        expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
            .to.equal([false, false, BigNumber.from(0), BigNumber.from(0), false].toString())
    })

    it("positivetest grantRole, revokerole", async (): Promise<void> => {
        await registryFromAdmin.grantRole(await registry.TRUSTED_ROLE(), adminAddress)
        expect(await registry.hasRole(await registry.TRUSTED_ROLE(), adminAddress))
            .to.equal(true)
        await registryFromAdmin.revokeRole(await registry.TRUSTED_ROLE(), adminAddress)
        expect(await registry.hasRole(await registry.TRUSTED_ROLE(), adminAddress))
            .to.equal(false)
    })

    it("negativetest grantRole, revokerole", async (): Promise<void> => {
        await expect(registryFromUser0.grantRole(await registry.TRUSTED_ROLE(), user0Address))
            .to.be.revertedWith("AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing "
            + "role 0x0000000000000000000000000000000000000000000000000000000000000000")
    })

    it("positivetest setExpirationTime", async (): Promise<void> => {
        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address, true, true, MAX_INT, MAX_INT, true)
        await expect(registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Publish, 7))
            .to.emit(registry, "PermissionUpdated").withArgs(streamId1, user0Address, true, true, 7, MAX_INT, true)
        expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(7), BigNumber.from(MAX_INT), true].toString())
        await expect(registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Subscribe, 7))
            .to.emit(registry, "PermissionUpdated").withArgs(streamId1, user0Address, true, true, 7, 7, true)
        expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(7), BigNumber.from(7), true].toString())
    })

    it("negativetest setExpirationTime", async (): Promise<void> => {
        await expect(registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Edit, 7))
            .to.be.revertedWith("error_timeOnlyObPubSub")
        await expect(registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Delete, 7))
            .to.be.revertedWith("error_timeOnlyObPubSub")
        await expect(registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Share, 7))
            .to.be.revertedWith("error_timeOnlyObPubSub")
    })

    it("edgecases expirationtime", async (): Promise<void> => {
        blocktime = await getBlocktime() + 1
        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address, true, true, blocktime, blocktime, true)
        expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true].toString())
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        // setting it again will advance the blocktime and expire the rights
        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address, true, true, blocktime, blocktime, true)
        expect((await registry.getPermissionsForUser(streamId1, user0Address)).toString())
            .to.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true].toString())
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        // give public publish permission, check again
        await registryFromAdmin.setPublicPermission(streamId1, blocktime + 2, blocktime + 2)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        // setting it again (one more transaction) with the same number will advance the blocktime and expire the rights
        await registryFromAdmin.setPublicPermission(streamId1, blocktime + 2, blocktime + 2)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
    })

    it("positiveTest trustedSetStreams", async (): Promise<void> => {
        const STREAMS_TO_MIGRATE = 50
        const streamIds: string[] = []
        const users: string[] = []
        const metadatas: string[] = []
        const permissions = []
        for (let i = 0; i < STREAMS_TO_MIGRATE; i++) {
            const user = Wallet.createRandom()
            streamIds.push(`${user.address}/streamidbulkmigrate/id${i}`)
            users.push(user.address)
            metadatas.push(`metadata-${i}`)
            permissions.push({
                canEdit: true,
                canDelete: true,
                publishExpiration: MAX_INT,
                subscribeExpiration: MAX_INT,
                canGrant: true
            })
        }
        await registryFromMigrator.trustedSetStreams(streamIds, users, metadatas, permissions)
        for (let i = 0; i < STREAMS_TO_MIGRATE; i++) {
            expect(await registry.getStreamMetadata(streamIds[i])).to.equal(metadatas[i])
        }
    })

    it("positiveTest trustedSetPermissions", async (): Promise<void> => {
        const STREAMS_TO_MIGRATE = 50
        const streamIds: string[] = []
        const users: string[] = []
        const metadatas: string[] = []
        const permissions = []
        for (let i = 0; i < STREAMS_TO_MIGRATE; i++) {
            const user = Wallet.createRandom()
            streamIds.push(`${user.address}/streamidbulkmigrate/id${i}`)
            users.push(user.address)
            metadatas.push(`metadata-${i}`)
            permissions.push({
                canEdit: true,
                canDelete: true,
                publishExpiration: MAX_INT,
                subscribeExpiration: MAX_INT,
                canGrant: true
            })
        }
        await registryFromMigrator.trustedCreateStreams(streamIds, metadatas)
        await registryFromMigrator.trustedSetPermissions(streamIds, users, permissions)
        for (let i = 0; i < STREAMS_TO_MIGRATE; i++) {
            expect(await registry.getStreamMetadata(streamIds[i])).to.equal(metadatas[i])
        }
    })

    it("negativetest trustedSetPermissions", async (): Promise<void> => {
        const permissions = {
            canEdit: true,
            canDelete: true,
            publishExpiration: MAX_INT,
            subscribeExpiration: MAX_INT,
            canGrant: true
        }
        await expect(registryFromUser0.trustedCreateStreams([`${user0Address}/test`], ["meta"]))
            .to.be.revertedWith("error_mustBeTrustedRole")
        await expect(registryFromUser0.trustedSetPermissions([`${user0Address}/test`], [user0Address], [permissions]))
            .to.be.revertedWith("error_mustBeTrustedRole")
    })
})
