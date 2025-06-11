import { readFileSync } from 'fs'
import yaml from 'js-yaml'

const ENVIRONMENT_IDS = ['dev2', 'polygon', 'polygonAmoy', 'peaq', 'iotex']

const output = {}

for (const environmentId of ENVIRONMENT_IDS) {
    const fileId = (environmentId === 'polygonAmoy') ? 'amoy' : environmentId
    const fileName = `subgraph_${fileId}.yaml`
    const fileContents = readFileSync(fileName, 'utf8')
    const yamlData = yaml.load(fileContents)
    const contracts = {}
    for (const dataSource of yamlData.dataSources) {
        const source = dataSource.source
        const key = (source.abi === 'NodeRegistry') ? 'StorageNodeRegistry' : source.abi
        contracts[key] = {
            address: source.address,
            startBlock: source.startBlock
        }
    }
    const networkId = (environmentId === 'polygon') 
        ? 'matic' : 
            ((environmentId === 'polygonAmoy') ? 'polygon-amoy' : environmentId)
    output[environmentId] = {
        networkId,
        hubContracts: (environmentId !== 'iotex'),
        contracts
    }
}

console.log(JSON.stringify(output, undefined, 4))

