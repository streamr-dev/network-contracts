import { upgrades, ethers } from "hardhat"
import { expect } from "chai"
import { utils } from "ethers"

import ENSCacheJson from "../../../artifacts/contracts/ENS/ENSCache.sol/ENSCache.json"
import ForwarderJson from "../../../artifacts/@openzeppelin/contracts/metatx/MinimalForwarder.sol/MinimalForwarder.json"
import type { ENSCache, MinimalForwarder, StreamRegistry } from "../../../typechain"

describe("ENSCache", async (): Promise<void> => {
    let wallets
    let ensCacheFromAdmin: ENSCache
    let minimalForwarderFromAdmin: MinimalForwarder
    // let minimalForwarderFromUser0: MinimalForwarder
    let registryFromAdmin: StreamRegistry
    let adminAddress: string

    before(async (): Promise<void> => {
        wallets = await ethers.getSigners()
        adminAddress = wallets[0].address
        // Deploy contracs
        const minimalForwarderFromAdminFactory = await ethers.getContractFactory(
            ForwarderJson.abi,
            ForwarderJson.bytecode,
            wallets[0]
        )
        minimalForwarderFromAdmin = (await minimalForwarderFromAdminFactory.deploy()) as MinimalForwarder
        await minimalForwarderFromAdmin.deployed()
        const ensCacheFromAdminFactory = await ethers.getContractFactory(
            ENSCacheJson.abi,
            ENSCacheJson.bytecode,
            wallets[0]
        )
        ensCacheFromAdmin = (await ensCacheFromAdminFactory.deploy(adminAddress, "jobid")) as ENSCache
        await ensCacheFromAdmin.deployed()

        const streamRegistryFactory = await ethers.getContractFactory("StreamRegistryV5")
        const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory, [
            ensCacheFromAdmin.address,
            minimalForwarderFromAdmin.address
        ], { kind: "uups" })
        registryFromAdmin = await streamRegistryFactoryTx.deployed() as StreamRegistry
        await registryFromAdmin.grantRole(await registryFromAdmin.TRUSTED_ROLE(), ensCacheFromAdmin.address)
        await ensCacheFromAdmin.setStreamRegistry(registryFromAdmin.address)
    })

    it("updates the cache entry and creates a stream: requestENSOwnerAndCreateStream", async () => {
        const tx = await ensCacheFromAdmin.requestENSOwnerAndCreateStream("ensdomain1", "/path", "metadata", adminAddress)
        const tr = await tx.wait()
        const ensName = tr.logs[0].topics[1]
        await expect(ensCacheFromAdmin.fulfillENSOwner(ensName, utils.hexZeroPad(adminAddress, 32)))
            .to.emit(registryFromAdmin, "StreamCreated")
    })
})
