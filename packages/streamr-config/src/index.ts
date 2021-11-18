import { default as data } from "./networks.json"
import { Address } from "./Address"
import { Network } from "./Network"
import { Environment } from "./Environment"

export const loadConfig = (): Map<string, Network> => {
  const result = new Map<string, Network>()
  for (const [name, netData] of Object.entries(data)) {
    const chainId: number = netData.chainId
    const environment = netData.environment as Environment
    const contracts: Map<string, Address> = new Map()
    for (const [contractName, address] of Object.entries(netData.contracts)) {
      contracts.set(contractName, new Address(address))
    }
    const network = new Network(chainId, environment, contracts)
    result.set(name, network)
  }
  return result
}
