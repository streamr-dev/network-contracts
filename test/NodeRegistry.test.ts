import { expect, use } from 'chai'
import { deployContract, MockProvider, solidity } from 'ethereum-waffle'
import { Contract, Wallet, utils } from 'ethers'
import { BigNumber } from 'bignumber.js'
// import chaiBignumber from 'chai-bignumber'

import NodeRegistry from '../build/NodeRegistry.json'
import ERC20Mintable from '../build/ERC20Mintable.json'
import TokenBalanceWeightStrategy from '../build/TokenBalanceWeightStrategy.json'
import WeightedNodeRegistry from '../build/WeightedNodeRegistry.json'

// use(require('chai-bignumber')());
use(require('chai-bignumber')());
use(solidity);


const nodeCount = 3

describe("NodeRegistry", (): void => {
    const accounts: Wallet[] = new MockProvider().getWallets()
    const creatorAddress = accounts[0].address
    let node_metadatas: string[] = []
    let node_addresses: string[] = []
    let testToken: Contract
    let nodeRegAsCreator: Contract
    let nodeRegAsSigners: Contract[] = []
    let tokenStrat: Contract
    let weightedReg: Contract
   
    for(var i=0; i < nodeCount; i++){
        node_metadatas[i]= `http://node.url${i}`
        node_addresses[i] = accounts[i+1].address
    }

    const day = 86400
    console.log(`creator: ${creatorAddress}`)
    before(async () => {
        //pass half the trackers in constructor, and set the others
        let initialNodes = []
        let initialMetadata = []
        
        for(let i=0; i < nodeCount; i++){
            initialMetadata.push(node_metadatas[i]);
            initialNodes.push(node_addresses[i])
        }

        nodeRegAsCreator = await deployContract(accounts[0], NodeRegistry, [creatorAddress, false, initialNodes, initialMetadata]);
        for(var i=0; i < nodeCount; i++){
            nodeRegAsSigners[i] = nodeRegAsCreator.connect(accounts[i+1]);
        }
        
        for(let i=0; i < nodeCount; i++){
            expect(await nodeRegAsSigners[i].createOrUpdateNodeSelf(node_metadatas[i]))
                .to.emit(nodeRegAsCreator, 'NodeUpdated')
        }

        testToken = await deployContract(accounts[0], ERC20Mintable, ["name","symbol"]);
        await testToken.mint(node_addresses[0], utils.parseUnits("10", "ether"), { from: creatorAddress })
        await testToken.mint(node_addresses[1], utils.parseUnits("100", "ether"), { from: creatorAddress })
        tokenStrat = await deployContract(accounts[0], TokenBalanceWeightStrategy, [testToken.address]);
        weightedReg = await deployContract(accounts[0], WeightedNodeRegistry, [creatorAddress, false, tokenStrat.address, initialNodes, initialMetadata]);
    })
    describe("NodeRegistry", () => {
        it("node count and linked list functionality", async () => {
            var ncount = await nodeRegAsCreator.nodeCount()
            let ncountnumber = ncount.toNumber()

            // expect(nodeCount).to.bignumber.equal(new BigNumber(ncountnumber))

            expect(nodeCount).to.equal(ncountnumber)

            const allNodes = await nodeRegAsCreator.getNodes();
            console.log(`allnodes: ${JSON.stringify(allNodes)}`)
            for(var i=0; i < nodeCount; i++){
                var node = await nodeRegAsCreator.getNodeByNumber(i)
                expect(node[0]).to.equal(node_addresses[i])
            }
            
            for(i=0; i < nodeCount; i++){
                var node = allNodes[i]
                expect(node[0]).to.equal(node_addresses[i])
            }
        })
        it("can remove node", async () => {
            //test removal from middle of list
            var mid = Math.floor(nodeCount/2)
            expect(await nodeRegAsSigners[mid].removeNodeSelf()).to.emit(nodeRegAsCreator, 'NodeRemoved')
            expect(nodeRegAsSigners[mid].removeNodeSelf()).to.be.reverted;

            var ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount - 1).to.equal(ncount)
            var j=0
            for(var i=0; i < nodeCount - 1; i++){
                // check that every node except mid is listed
                var nodeadd = (await nodeRegAsCreator.getNodeByNumber(i))[0]
                if(j == mid)
                    j++
                expect(nodeadd).to.equal(node_addresses[j++])
            }
            //re-add middle node
            expect(await nodeRegAsSigners[mid].createOrUpdateNodeSelf(node_metadatas[mid])).to.emit(nodeRegAsCreator, 'NodeUpdated')

            ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount).to.equal(ncount)
        })
        
        it("only admin can remove/modify another node", async () => {
            //test removal from middle of list
            var mid = Math.floor(nodeCount/2)
            expect(nodeRegAsSigners[mid].removeNode(node_addresses[mid])).to.be.reverted
            expect(await nodeRegAsCreator.removeNode(node_addresses[mid])).to.emit(nodeRegAsCreator, 'NodeRemoved')

            var ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount - 1).to.equal(ncount)
            var j=0
            for(var i=0; i < nodeCount - 1; i++){
                // check that every node except mid is listed
                var nodeadd = (await nodeRegAsCreator.getNodeByNumber(i))[0]
                if(j == mid)
                    j++
                expect(nodeadd).to.equal(node_addresses[j++])
            }
            //re-add middle node
            expect(nodeRegAsSigners[mid].createOrUpdateNode(node_addresses[mid], node_metadatas[mid])).to.be.reverted
            expect(await nodeRegAsCreator.createOrUpdateNode(node_addresses[mid], node_metadatas[mid])).to.emit(nodeRegAsCreator, 'NodeUpdated')
            ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount).to.equal(ncount)
        })

        it("can update node", async () => {
            const newurl = "http://another.url"
            expect(await nodeRegAsSigners[0].createOrUpdateNodeSelf(newurl)).to.emit(nodeRegAsCreator, 'NodeUpdated')

            var ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount).to.equal(ncount)
            var nodeinfo = await nodeRegAsCreator.getNode(node_addresses[0])
            expect(nodeinfo[1]).to.equal(newurl)
        }),
        it("whitelist works", async () => {
            const newurl = "http://another.url2"
            expect(nodeRegAsSigners[0].setRequiresWhitelist(true)).to.be.reverted
            await nodeRegAsCreator.setRequiresWhitelist(true)
            expect(await nodeRegAsCreator.kickOut(node_addresses[0])).to.emit(nodeRegAsCreator, "NodeWhitelistRejected")
            expect(nodeRegAsSigners[0].createOrUpdateNodeSelf(newurl)).to.be.reverted
            expect(nodeRegAsSigners[0].whitelistApproveNode(node_addresses[0])).to.be.reverted
            await nodeRegAsCreator.whitelistApproveNode(node_addresses[0])
            expect(await nodeRegAsSigners[0].createOrUpdateNodeSelf(newurl)).to.emit(nodeRegAsCreator, "NodeUpdated")
            var ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount).to.equal(ncount)
            var nodeinfo = await nodeRegAsCreator.getNode(node_addresses[0])
            expect(nodeinfo[1]).to.equal(newurl)
            
        })
    })
    describe("WeightedNodeRegistry", () => {
        it("getWeight() works", async () => {
            for(var i=0; i < nodeCount; i++){
                let tokbal = await testToken.balanceOf(node_addresses[i])
                let weight = await weightedReg.getWeight(node_addresses[i])
                expect(tokbal).to.equal(weight)
            }  
        })
    })
})
