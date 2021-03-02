import { expect, use } from 'chai'
import { deployContract, MockProvider, solidity } from 'ethereum-waffle'
import { Contract, Wallet, utils } from 'ethers'
// import chaiBignumber from 'chai-bignumber'

import NodeRegistry from '../build/NodeRegistry.json'
import ERC20Mintable from '../build/ERC20Mintable.json'
import TokenBalanceWeightStrategy from '../build/TokenBalanceWeightStrategy.json'
import WeightedNodeRegistry from '../build/WeightedNodeRegistry.json'

// use(require('chai-bignumber')());
use(require('chai-bignumber')());

const nodeCount = 3

describe("NodeRegistry", (): void => {
    const accounts: Wallet[] = new MockProvider().getWallets()
    const creator = accounts[0].address
    let nodes: string[] = []
    let node_addresses: Wallet[] = []
    let testToken: Contract
    let stReg: Contract
    let tokenStrat: Contract
    let weightedReg: Contract
    for(var i=0; i < nodeCount; i++){
        nodes[i]= `http://node.url${i}`
        node_addresses[i] = accounts[i+1]
    }
    const day = 86400
    console.log(`creator: ${creator}`)
    before(async () => {
        //console.log(JSON.stringify(NodeRegistry))
        //pass half the trackers in constructor, and set the others
        var initialNodes = []
        var initialMetadata = []
        
        for(var i=0; i < nodeCount/2; i++){
            initialMetadata.push(nodes[i]);
            initialNodes.push(node_addresses[i].address)
        }

        // stReg = await NodeRegistry.new(creator, false, initialNodes, initialMetadata, { from: creator })
        stReg = await deployContract(accounts[0], NodeRegistry, [creator, false, initialNodes, initialMetadata]);
        // for(; i < nodeCount; i++){
        //     expect(await stReg.createOrUpdateNodeSelf(nodes[i],{from: node_addresses[i]}))
        //         .to.emit(stReg, 'NodeUpdated')
        // }

        // // testToken = await ERC20Mintable.new("name","symbol",{ from: creator })
        // testToken = await deployContract(creator, ERC20Mintable, ["name","symbol"]);
        // await testToken.mint(node_addresses[0], utils.parseUnits("10", "ether"), { from: creator })
        // await testToken.mint(node_addresses[1], utils.parseUnits("100", "ether"), { from: creator })
        // // tokenStrat = await TokenBalanceWeightStrategy.new(testToken.address, { from: creator })
        // tokenStrat = await deployContract(creator, TokenBalanceWeightStrategy, [testToken.address]);
        // // weightedReg = await WeightedNodeRegistry.new(creator, false, tokenStrat.address, initialNodes, initialMetadata, { from: creator })
        // weightedReg = await deployContract(creator, TokenBalanceWeightStrategy, [creator, false, tokenStrat.address, initialNodes, initialMetadata]);
    })
    // describe("NodeRegistry", () => {
        it("node count and linked list functionality", async () => {
            var ncount = await stReg.nodeCount()
            expect(nodeCount).to.bignumber.equal(ncount)
            // const allNodes = await stReg.getNodes();
            // console.log(`allnodes: ${JSON.stringify(allNodes)}`)
            // for(var i=0; i < nodeCount; i++){
            //     var node = await stReg.getNodeByNumber(i)
            //     assertEqual(node[0], node_addresses[i])
            // }
            
            // for(i=0; i < nodeCount; i++){
            //     var node = allNodes[i]
            //     assertEqual(node[0], node_addresses[i])
            // }
        })
    //     it("can remove node", async () => {
    //         //test removal from middle of list
    //         var mid = Math.floor(nodeCount/2)
    //         assertEvent(await stReg.removeNodeSelf({from: node_addresses[mid]}), "NodeRemoved")
    //         await assertFails(stReg.removeNodeSelf({from: node_addresses[mid]}))       
    //         var ncount = await stReg.nodeCount()
    //         assertEqual(nodeCount -1, ncount)
    //         var j=0
    //         for(var i=0; i < nodeCount - 1; i++){
    //             // check that every node except mid is listed
    //             var nodeadd = (await stReg.getNodeByNumber(i))[0]
    //             if(j == mid)
    //                 j++
    //             assertEqual(nodeadd, node_addresses[j++])
    //         }
    //         //re-add middle node
    //         assertEvent(await stReg.createOrUpdateNodeSelf(nodes[mid],{from: node_addresses[mid]}), "NodeUpdated")
    //         ncount = await stReg.nodeCount()
    //         assertEqual(nodeCount, ncount)
    //     }),
        
    //     it("only admin can remove/modify another node", async () => {
    //         //test removal from middle of list
    //         var mid = Math.floor(nodeCount/2)
    //         await assertFails(stReg.removeNode(node_addresses[mid], {from: node_addresses[mid]}))       
    //         assertEvent(await stReg.removeNode(node_addresses[mid], {from: creator}), "NodeRemoved")
    //         var ncount = await stReg.nodeCount()
    //         assertEqual(nodeCount -1, ncount)
    //         var j=0
    //         for(var i=0; i < nodeCount - 1; i++){
    //             // check that every node except mid is listed
    //             var nodeadd = (await stReg.getNodeByNumber(i))[0]
    //             if(j == mid)
    //                 j++
    //             assertEqual(nodeadd, node_addresses[j++])
    //         }
    //         //re-add middle node
    //         //console.log(`mid_address: ${node_addresses[mid]}`)
    //         await assertFails(stReg.createOrUpdateNode(node_addresses[mid], nodes[mid], {from: node_addresses[mid]}))
    //         assertEvent(await stReg.createOrUpdateNode(node_addresses[mid], nodes[mid], {from: creator}), "NodeUpdated")
    //         //const allNodes = await stReg.getNodes();
    //         //console.log(`allnodes: ${JSON.stringify(allNodes)}`)
    //         ncount = await stReg.nodeCount()
    //         assertEqual(nodeCount, ncount)
    //     }),

    //     it("can update node", async () => {
    //         const newurl = "http://another.url"
    //         assertEvent(await stReg.createOrUpdateNodeSelf(newurl,  {from: node_addresses[0]}), "NodeUpdated")
    //         var ncount = await stReg.nodeCount()
    //         assertEqual(nodeCount, ncount)
    //         var nodeinfo = await stReg.getNode(node_addresses[0])
    //         assertEqual(nodeinfo[1], newurl)
    //     }),
    //     it("whitelist works", async () => {
    //         const newurl = "http://another.url2"
    //         await assertFails(stReg.setRequiresWhitelist(true, {from: node_addresses[0]}))
    //         await stReg.setRequiresWhitelist(true, {from: creator})
    //         assertEvent(await stReg.kickOut(node_addresses[0],  {from: creator}),"NodeWhitelistRejected")
    //         await assertFails(stReg.createOrUpdateNodeSelf(newurl,  {from: node_addresses[0]}))
    //         await assertFails(stReg.whitelistApproveNode(node_addresses[0],  {from: node_addresses[0]}))
    //         await stReg.whitelistApproveNode(node_addresses[0],  {from: creator})
    //         assertEvent(await stReg.createOrUpdateNodeSelf(newurl,  {from: node_addresses[0]}), "NodeUpdated")
    //         var ncount = await stReg.nodeCount()
    //         assertEqual(nodeCount, ncount)
    //         var nodeinfo = await stReg.getNode(node_addresses[0])
    //         assertEqual(nodeinfo[1], newurl)
            
    //     })
    // }),
    // describe("WeightedNodeRegistry", () => {
    //     it("getWeight() works", async () => {
    //         for(var i=0; i < nodeCount; i++){
    //             let tokbal = await testToken.balanceOf(node_addresses[i])
    //             let weight = await weightedReg.getWeight(node_addresses[i])
    //             assertEqual(tokbal, weight)
    //         }  
    //     })
    // })
})
