import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'

// import StreamRegistryJson from '../artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json'
// import StreamStorageRegistryJson from '../artifacts/contracts/StreamStorageRegistry/StreamStorageRegistry.sol/StreamStorageRegistry.json'
import ForwarderJson from '../test-contracts/MinimalForwarder.json'
import type { MinimalForwarder } from '../test-contracts/MinimalForwarder'
import type { StreamStorageRegistry, StreamRegistry, NodeRegistry } from '../typechain'

const { deployContract, provider } = waffle

use(waffle.solidity)
describe('StreamStorageRegistry', () => {
    let streamReg: StreamRegistry
    let nodeReg: NodeRegistry
    let reg: StreamStorageRegistry

    let forwarder: MinimalForwarder

    const [admin, trusted, node0, node1, node2] = provider.getWallets()

    const nodes = provider.getWallets().slice(2)
    const nodeAddresses = nodes.map((w) => w.address)
    const nodeUrls = nodes.map((w, i) => `http://node${i}.url`)

    const testStreamId = admin.address.toLowerCase() + '/test'

    before(async () => {
        // set up nodes
        const nodeRegDeploy = await ethers.getContractFactory('NodeRegistry')
        const nodeRegDeployTx = await upgrades.deployProxy(nodeRegDeploy, [admin.address,
            false, nodeAddresses, nodeUrls], {
            kind: 'uups'
        })
        nodeReg = await nodeRegDeployTx.deployed() as NodeRegistry

        // set up streams
        forwarder = await deployContract(trusted, ForwarderJson) as MinimalForwarder
        const streamRegistryFactory = await ethers.getContractFactory('StreamRegistry')
        const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory,
            ['0x0000000000000000000000000000000000000000', forwarder.address], {
                kind: 'uups'
            })
        streamReg = await streamRegistryFactoryTx.deployed() as StreamRegistry
        await streamReg.createStream('/test', 'test-metadata')
        await streamReg.grantRole(await streamReg.TRUSTED_ROLE(), trusted.address)

        // deploy StreamStorageRegistry
        const strDeploy = await ethers.getContractFactory('StreamStorageRegistry')
        const strDeployTx = await upgrades.deployProxy(strDeploy, [streamReg.address, nodeReg.address, forwarder.address], {
            kind: 'uups'
        })
        reg = await strDeployTx.deployed() as StreamStorageRegistry
    })

    it('can add nodes to a stream', async () => {
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.false
        await expect(reg.addStorageNode(testStreamId, node1.address))
            .to.emit(reg, 'Added').withArgs(testStreamId, node1.address)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.true

        // re-adding emits same events (dateCreated not updated, TODO: test/assert?)
        await expect(reg.addStorageNode(testStreamId, node1.address))
            .to.emit(reg, 'Added').withArgs(testStreamId, node1.address)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.true

        await reg.removeStorageNode(testStreamId, node1.address)
    })

    it('can remove nodes from a stream', async () => {
        await reg.addStorageNode(testStreamId, node0.address)

        expect(await reg.isStorageNodeOf(testStreamId, node0.address)).to.be.true
        await expect(reg.removeStorageNode(testStreamId, node0.address))
            .to.emit(reg, 'Removed').withArgs(testStreamId, node0.address)
        expect(await reg.isStorageNodeOf(testStreamId, node0.address)).to.be.false
    })

    it('can add and remove nodes from a stream', async () => {
        await reg.addStorageNode(testStreamId, node0.address)
        await expect(reg.addAndRemoveStorageNodes(testStreamId, [nodes[3].address, nodes[4].address], [nodes[0].address, nodes[1].address]))
            .to.emit(reg, 'Added').withArgs(testStreamId, nodes[3].address)
            .and.emit(reg, 'Added').withArgs(testStreamId, nodes[4].address)
            .and.emit(reg, 'Removed').withArgs(testStreamId, nodes[0].address)
            .and.emit(reg, 'Removed').withArgs(testStreamId, nodes[1].address)
        expect(await reg.isStorageNodeOf(testStreamId, nodes[3].address)).to.be.true
        expect(await reg.isStorageNodeOf(testStreamId, nodes[4].address)).to.be.true
        expect(await reg.isStorageNodeOf(testStreamId, nodes[0].address)).to.be.false
        expect(await reg.isStorageNodeOf(testStreamId, nodes[1].address)).to.be.false
    })

    it('gives errors for non-existent streams and nodes', async () => {
        await expect(reg.addStorageNode(testStreamId, admin.address))
            .to.be.revertedWith('error_storageNodeNotRegistered')
        await expect(reg.addStorageNode('foo-bar', node0.address))
            .to.be.revertedWith('error_streamDoesNotExist')

        await expect(reg.addAndRemoveStorageNodes(testStreamId, [admin.address], []))
            .to.be.revertedWith('error_storageNodeNotRegistered')
        await expect(reg.addAndRemoveStorageNodes('foo-bar', [], []))
            .to.be.revertedWith('error_streamDoesNotExist')
    })

    it('will only modify nodes on sender\'s own streams', async () => {
        const testStreamId2 = node0.address.toLowerCase() + '/test3'
        await streamReg.connect(node0).createStream('/test3', 'test3-metadata')
        await expect(reg.addStorageNode(testStreamId2, node0.address))
            .to.be.revertedWith('error_noEditPermission')
        await expect(reg.removeStorageNode(testStreamId2, node0.address))
            .to.be.revertedWith('error_noEditPermission')
        await expect(reg.addAndRemoveStorageNodes(testStreamId2, [], []))
            .to.be.revertedWith('error_noEditPermission')
    })

    it('removed nodes and streams aren\'t returned by isStorageNodeOf', async () => {
        const testStreamId2 = admin.address.toLowerCase() + '/test2'
        await streamReg.createStream('/test2', 'test2-metadata')

        await reg.addStorageNode(testStreamId2, node0.address)
        await reg.addStorageNode(testStreamId, node2.address)

        expect(await reg.isStorageNodeOf(testStreamId2, node0.address)).to.be.true
        await streamReg.deleteStream(testStreamId2)
        expect(await reg.isStorageNodeOf(testStreamId2, node0.address)).to.be.false

        expect(await reg.isStorageNodeOf(testStreamId, node2.address)).to.be.true
        await nodeReg.removeNode(node2.address)
        expect(await reg.isStorageNodeOf(testStreamId, node2.address)).to.be.false
    })

    it('allows TRUSTED_ROLE address to add and remove nodes', async () => {
        const r = reg.connect(trusted)
        await expect(r.addStorageNode(testStreamId, node1.address))
            .to.emit(reg, 'Added').withArgs(testStreamId, node1.address)
        expect(await r.isStorageNodeOf(testStreamId, node1.address)).to.be.true

        await expect(r.removeStorageNode(testStreamId, node1.address))
            .to.emit(reg, 'Removed').withArgs(testStreamId, node1.address)
        expect(await r.isStorageNodeOf(testStreamId, node1.address)).to.be.false

        await expect(r.addAndRemoveStorageNodes(testStreamId, [nodes[0].address, nodes[1].address], [nodes[2].address, nodes[3].address]))
            .to.emit(reg, 'Added').withArgs(testStreamId, nodes[0].address)
            .and.emit(reg, 'Added').withArgs(testStreamId, nodes[1].address)
            .and.emit(reg, 'Removed').withArgs(testStreamId, nodes[2].address)
            .and.emit(reg, 'Removed').withArgs(testStreamId, nodes[3].address)
        expect(await r.isStorageNodeOf(testStreamId, nodes[0].address)).to.be.true
        expect(await r.isStorageNodeOf(testStreamId, nodes[1].address)).to.be.true
        expect(await r.isStorageNodeOf(testStreamId, nodes[2].address)).to.be.false
        expect(await r.isStorageNodeOf(testStreamId, nodes[3].address)).to.be.false
    })
})
