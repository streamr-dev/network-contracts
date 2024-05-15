import { upgrades, ethers } from "hardhat"
import { expect } from "chai"
import { Wallet, utils } from "ethers"
import Debug from "debug"

import { getEIP2771MetaTx } from "./getEIP2771MetaTx"

import type { MinimalForwarder, NodeRegistry } from "../../../typechain"
import type { StreamRegistry, StreamStorageRegistry } from "../../../src/exports"

const { parseEther } = utils
const log = Debug("Streamr::test::StreamStorageRegistry")

describe("StreamStorageRegistry", () => {
    let registry: StreamStorageRegistry

    let streamRegistry: StreamRegistry
    let nodeRegistry: NodeRegistry

    let forwarder: MinimalForwarder
    let forwarderFromMetatxSender: MinimalForwarder

    let testStreamId: string

    let wallets: Wallet[]
    let nodes: Wallet[]
    let admin: Wallet
    let trusted: Wallet
    let node0: Wallet
    let node1: Wallet
    let node2: Wallet
    let metaTxSender: Wallet

    before(async () => {
        wallets = await ethers.getSigners() as unknown[] as Wallet[]
        ;[, trusted, metaTxSender, ...nodes] = wallets
        ;[node0, node1, node2] = nodes

        admin = Wallet.createRandom().connect(trusted.provider)
        await (await trusted.sendTransaction({ to: admin.address, value: parseEther("100") })).wait()

        testStreamId = admin.address.toLowerCase() + "/test"

        const nodeAddresses = nodes.map((w) => w.address)
        const nodeUrls = nodes.map((w, i) => `http://node${i}.url`)

        log("set up nodes")
        const nodeRegDeploy = await ethers.getContractFactory("NodeRegistry")
        const nodeRegDeployTx = await upgrades.deployProxy(nodeRegDeploy, [admin.address,
            false, nodeAddresses, nodeUrls], {
            kind: "uups"
        })
        nodeRegistry = await nodeRegDeployTx.deployed() as NodeRegistry

        log("set up streams")
        const forwarderFromMetatxSenderFactory = await ethers.getContractFactory("MinimalForwarder", wallets[9])
        forwarder = await forwarderFromMetatxSenderFactory.deploy() as MinimalForwarder
        forwarderFromMetatxSender = forwarder.connect(metaTxSender)
        const streamRegistryFactory = await ethers.getContractFactory("StreamRegistryV5", { signer: admin })
        const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory, [
            "0x0000000000000000000000000000000000000000",
            forwarder.address
        ], { kind: "uups"})
        streamRegistry = await streamRegistryFactoryTx.deployed() as StreamRegistry
        await streamRegistry.createStream("/test", "test-metadata")
        await streamRegistry.grantRole(await streamRegistry.TRUSTED_ROLE(), trusted.address)

        log("deploy StreamStorageRegistry")
        const strDeploy = await ethers.getContractFactory("StreamStorageRegistry", { signer: admin })
        const strDeployTx = await upgrades.deployProxy(strDeploy, [
            streamRegistry.address,
            nodeRegistry.address,
            forwarder.address
        ], { kind: "uups" })
        await strDeployTx.deployed()

        // upgrader needs to be trusted as well
        log("upgrade to StreamStorageRegistryV2")
        await streamRegistry.grantRole(await streamRegistry.TRUSTED_ROLE(), admin.address)
        const strV2Deploy = await ethers.getContractFactory("StreamStorageRegistryV2", { signer: admin })
        const strV2DeployTx = await upgrades.upgradeProxy(strDeployTx.address, strV2Deploy, {
            kind: "uups"
        })
        registry = await strV2DeployTx.deployed() as StreamStorageRegistry
        await streamRegistry.revokeRole(await streamRegistry.TRUSTED_ROLE(), admin.address)
    })

    it("can add nodes to a stream", async () => {
        expect(await registry.isStorageNodeOf(testStreamId, node1.address)).to.be.false
        await expect(registry.addStorageNode(testStreamId, node1.address))
            .to.emit(registry, "Added").withArgs(testStreamId, node1.address)
        expect(await registry.isStorageNodeOf(testStreamId, node1.address)).to.be.true

        // re-adding emits same events (dateCreated not updated, TODO: test/assert?)
        await expect(registry.addStorageNode(testStreamId, node1.address))
            .to.emit(registry, "Added").withArgs(testStreamId, node1.address)
        expect(await registry.isStorageNodeOf(testStreamId, node1.address)).to.be.true

        await registry.removeStorageNode(testStreamId, node1.address)
    })

    it("can remove nodes from a stream", async () => {
        await registry.addStorageNode(testStreamId, node0.address)

        expect(await registry.isStorageNodeOf(testStreamId, node0.address)).to.be.true
        await expect(registry.removeStorageNode(testStreamId, node0.address))
            .to.emit(registry, "Removed").withArgs(testStreamId, node0.address)
        expect(await registry.isStorageNodeOf(testStreamId, node0.address)).to.be.false
    })

    it("can add and remove nodes from a stream", async () => {
        await registry.addStorageNode(testStreamId, node0.address)
        await expect(registry.addAndRemoveStorageNodes(testStreamId, [nodes[3].address, nodes[4].address], [nodes[0].address, nodes[1].address]))
            .to.emit(registry, "Added").withArgs(testStreamId, nodes[3].address)
            .and.emit(registry, "Added").withArgs(testStreamId, nodes[4].address)
            .and.emit(registry, "Removed").withArgs(testStreamId, nodes[0].address)
            .and.emit(registry, "Removed").withArgs(testStreamId, nodes[1].address)
        expect(await registry.isStorageNodeOf(testStreamId, nodes[3].address)).to.be.true
        expect(await registry.isStorageNodeOf(testStreamId, nodes[4].address)).to.be.true
        expect(await registry.isStorageNodeOf(testStreamId, nodes[0].address)).to.be.false
        expect(await registry.isStorageNodeOf(testStreamId, nodes[1].address)).to.be.false
    })

    it("gives errors for non-existent streams and nodes", async () => {
        await expect(registry.addStorageNode(testStreamId, admin.address))
            .to.be.revertedWith("error_storageNodeNotRegistered")
        await expect(registry.addStorageNode("foo-bar", node0.address))
            .to.be.revertedWith("error_streamDoesNotExist")

        await expect(registry.addAndRemoveStorageNodes(testStreamId, [admin.address], []))
            .to.be.revertedWith("error_storageNodeNotRegistered")
        await expect(registry.addAndRemoveStorageNodes("foo-bar", [], []))
            .to.be.revertedWith("error_streamDoesNotExist")
    })

    it("will only modify nodes on sender's own streams", async () => {
        const testStreamId2 = node0.address.toLowerCase() + "/test3"
        await streamRegistry.connect(node0).createStream("/test3", "test3-metadata")
        await expect(registry.addStorageNode(testStreamId2, node0.address))
            .to.be.revertedWith("error_noEditPermission")
        await expect(registry.removeStorageNode(testStreamId2, node0.address))
            .to.be.revertedWith("error_noEditPermission")
        await expect(registry.addAndRemoveStorageNodes(testStreamId2, [], []))
            .to.be.revertedWith("error_noEditPermission")
    })

    it("removed nodes and streams aren't returned by isStorageNodeOf", async () => {
        const testStreamId2 = admin.address.toLowerCase() + "/test2"
        await streamRegistry.createStream("/test2", "test2-metadata")

        await registry.addStorageNode(testStreamId2, node0.address)
        await registry.addStorageNode(testStreamId, node2.address)

        expect(await registry.isStorageNodeOf(testStreamId2, node0.address)).to.be.true
        await streamRegistry.deleteStream(testStreamId2)
        expect(await registry.isStorageNodeOf(testStreamId2, node0.address)).to.be.false

        expect(await registry.isStorageNodeOf(testStreamId, node2.address)).to.be.true
        await nodeRegistry.connect(node2).removeNodeSelf()
        expect(await registry.isStorageNodeOf(testStreamId, node2.address)).to.be.false

        log("Clean up")
        await nodeRegistry.connect(node2).createOrUpdateNodeSelf("http://node2.url")
    })

    it("allows TRUSTED_ROLE address to add and remove nodes", async () => {
        const r = registry.connect(trusted)
        await expect(r.addStorageNode(testStreamId, node1.address))
            .to.emit(registry, "Added").withArgs(testStreamId, node1.address)
        expect(await r.isStorageNodeOf(testStreamId, node1.address)).to.be.true

        await expect(r.removeStorageNode(testStreamId, node1.address))
            .to.emit(registry, "Removed").withArgs(testStreamId, node1.address)
        expect(await r.isStorageNodeOf(testStreamId, node1.address)).to.be.false

        await expect(r.addAndRemoveStorageNodes(testStreamId, [nodes[0].address, nodes[1].address], [nodes[2].address, nodes[3].address]))
            .to.emit(registry, "Added").withArgs(testStreamId, nodes[0].address)
            .and.emit(registry, "Added").withArgs(testStreamId, nodes[1].address)
            .and.emit(registry, "Removed").withArgs(testStreamId, nodes[2].address)
            .and.emit(registry, "Removed").withArgs(testStreamId, nodes[3].address)
        expect(await r.isStorageNodeOf(testStreamId, nodes[0].address)).to.be.true
        expect(await r.isStorageNodeOf(testStreamId, nodes[1].address)).to.be.true
        expect(await r.isStorageNodeOf(testStreamId, nodes[2].address)).to.be.false
        expect(await r.isStorageNodeOf(testStreamId, nodes[3].address)).to.be.false
    })

    describe("EIP-2771 meta-transactions feature", () => {
        async function getAddStorageNodeMetaTx({
            forwarder = forwarderFromMetatxSender,
            signer = admin,
            gas
        }: { forwarder?: MinimalForwarder; signer?: Wallet; gas?: string } = {}) {
            // admin is creating and signing transaction, user0 is posting it and paying for gas
            const data = await registry.interface.encodeFunctionData("addStorageNode", [testStreamId, node1.address])
            const { request, signature } = await getEIP2771MetaTx(registry.address, data, forwarder, signer, gas)
            return { request, signature }
        }

        it("works as expected (happy path)", async (): Promise<void> => {
            log("Add storage node using meta-transaction")
            const { request, signature } = await getAddStorageNodeMetaTx()
            const signatureIsValid = await forwarderFromMetatxSender.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            await (await forwarderFromMetatxSender.execute(request, signature)).wait()

            expect(await registry.isStorageNodeOf(testStreamId, node1.address)).to.be.true

            log("Clean up")
            await registry.removeStorageNode(testStreamId, node1.address)
        })

        it("FAILS with wrong forwarder (negativetest)", async (): Promise<void> => {
            log("Deploy second minimal forwarder")
            const forwarderFromMetatxSenderFactory = await ethers.getContractFactory("MinimalForwarder", wallets[9])
            const wrongForwarder = await forwarderFromMetatxSenderFactory.deploy() as MinimalForwarder
            await wrongForwarder.deployed()

            log("Check that the correct forwarder is set")
            expect(await registry.isTrustedForwarder(forwarderFromMetatxSender.address)).to.be.true
            expect(await registry.isTrustedForwarder(wrongForwarder.address)).to.be.false

            log("Metatx seems to succeed with the wrong forwarder")
            const { request, signature } = await getAddStorageNodeMetaTx({ forwarder: wrongForwarder })
            const signatureIsValid = await wrongForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            await (await wrongForwarder.execute(request, signature)).wait()

            log("Tx failed, so storage node wasn't added")
            expect(await registry.isStorageNodeOf(testStreamId, node1.address)).to.be.false
        })

        it("FAILS with wrong signature (negativetest)", async (): Promise<void> => {
            const wrongSigner = ethers.Wallet.createRandom()
            const { request } = await getAddStorageNodeMetaTx()
            const { signature } = await getAddStorageNodeMetaTx({ signer: wrongSigner })
            const signatureIsValid = await forwarderFromMetatxSender.verify(request, signature)
            await expect(signatureIsValid).to.be.false
            await expect(forwarderFromMetatxSender.execute(request, signature))
                .to.be.revertedWith("MinimalForwarder: signature does not match request")
        })

        it("FAILS with not enough gas in internal transaction call (negativetest)", async (): Promise<void> => {
            log("Create a valid signature with too little gas for the tx")
            const { request, signature } = await getAddStorageNodeMetaTx({ gas: "1000" })
            const signatureIsValid = await forwarderFromMetatxSender.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            await (await forwarderFromMetatxSender.execute(request, signature)).wait()

            log("Tx failed, so storage node wasn't added")
            expect(await registry.isStorageNodeOf(testStreamId, node1.address)).to.be.false
        })

        it("works after resetting trusted forwarder (positivetest)", async (): Promise<void> => {
            log("Deploy second minimal forwarder")
            const forwarderFromMetatxSenderFactory = await ethers.getContractFactory("MinimalForwarder", wallets[9])
            const newForwarder = await forwarderFromMetatxSenderFactory.deploy() as MinimalForwarder
            await newForwarder.deployed()

            log("Set new forwarder")
            await streamRegistry.grantRole(await streamRegistry.TRUSTED_ROLE(), admin.address)
            await registry.setTrustedForwarder(newForwarder.address)

            log("Check that the correct forwarder is set")
            expect(await registry.isTrustedForwarder(forwarderFromMetatxSender.address)).to.be.false
            expect(await registry.isTrustedForwarder(newForwarder.address)).to.be.true

            log("Check that metatx works with new forwarder")
            const { request, signature } = await getAddStorageNodeMetaTx({ forwarder: newForwarder })
            const signatureIsValid = await newForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            await (await newForwarder.execute(request, signature)).wait()
            expect(await registry.isStorageNodeOf(testStreamId, node1.address)).to.be.true

            log("Clean up, set old forwarder back")
            await registry.removeStorageNode(testStreamId, node1.address)
            await registry.setTrustedForwarder(forwarderFromMetatxSender.address)
            await streamRegistry.revokeRole(await streamRegistry.TRUSTED_ROLE(), admin.address)
        })

        it("PREVENTS resetting trusted forwarder if caller not trusted (negativetest)", async (): Promise<void> => {
            await expect(registry.setTrustedForwarder(Wallet.createRandom().address))
                .to.be.revertedWith("error_mustBeTrustedRole")
        })
    })
})
