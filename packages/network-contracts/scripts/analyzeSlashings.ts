#!/usr/bin/env npx ts-node

import fetch from "node-fetch"
import { writeFileSync } from "fs"

import { Logger, TheGraphClient } from "@streamr/utils"
import { config } from "@streamr/config"

import { dateToBlockNumber } from "./utils/dateToBlockNumberPolygonSubgraph"
import { div, mul } from "./utils/bigint"

const { log } = console

const {
    START = "1709733209",
    END,

    // KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    CHAIN = "dev2",
    // ETHEREUM_RPC,
    // GAS_PRICE_GWEI,
    GRAPH_URL,

    OUTPUT_FILE,
} = process.env

const {
    // contracts: {
    //     StreamrConfig: streamrConfigAddressFromConfig,
    // },
    // rpcEndpoints: [{ url: ethereumRpcUrlFromConfig }],
    theGraphUrl,
} = (config as any)[CHAIN]

const serverUrl = GRAPH_URL ?? theGraphUrl
if (!serverUrl) { throw new Error("GRAPH_URL must be set in environment, or CHAIN must has theGraphUrl") }

const graphClient = new TheGraphClient({
    serverUrl,
    fetch,
    logger: new Logger(module)
})

type SlashingEvent = {
    date: number
    amount: bigint
    /** contract address */
    operator: string
    /** after the slashing, staked + held DATA */
    operatorDataLeftWei: bigint
}

async function getSlashings(): Promise<SlashingEvent[]> {
    let filterString = ""
    if (START || END) {
        filterString = "(where: {"
        if (START) {
            filterString += `date_gte: "${START}"`
        }
        if (END) {
            if (START) {
                filterString += ", "
            }
            filterString += `date_lte: "${END}"`
        }
        filterString += "}"
        filterString += ", first: 1000" // max COUNT that thegraph allows
        filterString += ", orderBy: date"
        filterString += ")"
    }

    log("Querying slashings, filter: %s", filterString)

    const query = `{
        slashingEvents ${filterString} {
          date
          amount
          operator {
            id
            valueWithoutEarnings
          }
        }
      }`

    log(query)

    const { slashingEvents } = await graphClient.queryEntity<any>({ query })
    return slashingEvents.map((e: any) => ({
        date: e.date,
        amount: BigInt(e.amount),
        operator: e.operator.id,
        operatorDataLeftWei: BigInt(e.operator.valueWithoutEarnings),
    }))
}

type SlashingRow = {
    /** contract address */
    operator: string
    operatorName: string
    owner: string
    totalOperatorTokensBeforeWei: bigint
    delegatorsOperatorTokensBeforeWei: bigint
    delegator: string
    delegatorDataLostWei: bigint
}
async function splitSlashing(slashingEvent: SlashingEvent): Promise<SlashingRow[]> {
    const eventBlockNumber = await dateToBlockNumber(slashingEvent.date)
    const operatorAt = (blockNumber: number) => `{
        operator(
          id: "${slashingEvent.operator}"
          block: {number: ${blockNumber}}
        ) {
          delegations {
            operatorTokenBalanceWei
            delegator {
              id
            }
          }
          operatorTokenTotalSupplyWei
          valueWithoutEarnings
          owner
          exchangeRate
          metadataJsonString
        }
      }`
    const res1 = await graphClient.queryEntity<any>({ query: operatorAt(eventBlockNumber - 1) })
    log("Response from block %s: %o", eventBlockNumber - 1, res1)
    const { operator: {
        delegations: delegationsBeforeArray,
        operatorTokenTotalSupplyWei: totalSupplyBefore,
        valueWithoutEarnings: dataWeiBefore,
        owner,
        exchangeRate, // DATA / operator token
        metadataJsonString,
    } } = res1
    const { operator: {
        delegations: delegationsAfterArray,
        operatorTokenTotalSupplyWei: totalSupplyAfter,
        valueWithoutEarnings: dataWeiAfter,
    } } = await graphClient.queryEntity<any>({ query: operatorAt(eventBlockNumber + 1) })

    let metadata: any = { name: slashingEvent.operator }
    try {
        metadata = JSON.parse(metadataJsonString)
    } catch (e) {
        log("Failed to parse metadata string '%s'", metadataJsonString)
    }

    const delegationsBefore = Object.fromEntries<bigint>(delegationsBeforeArray.map((d: any) => [
        d.delegator.id, BigInt(d.operatorTokenBalanceWei)
    ]))
    const delegationsAfter = Object.fromEntries<bigint>(delegationsAfterArray.map((d: any) => [
        d.delegator.id, BigInt(d.operatorTokenBalanceWei)
    ]))

    const slashedOperatorTokens = Object.fromEntries(Object.entries(delegationsBefore).map(([delegator, before]) => {
        const after = delegationsAfter[delegator] ?? BigInt(0)
        return [delegator, before - after]
    }))

    Object.keys(slashedOperatorTokens).forEach((d) => {
        log("Delegator %s lost %s tokens", d, slashedOperatorTokens[d])
    })
    const totalSlashedOperatorTokens = Object.values(slashedOperatorTokens).reduce((a, b) => a + b, BigInt(0))
    log("Summed:     %s", totalSlashedOperatorTokens)
    log("Multiplied: %s", div(slashingEvent.amount, exchangeRate))
    log("Difference: %s", BigInt(totalSupplyBefore) - BigInt(totalSupplyAfter))

    const valueDifferenceWei = dataWeiBefore - dataWeiAfter

    log("Slashing amount DATA from event:      %s", slashingEvent.amount)
    log("Slashing amount DATA from difference: %s", valueDifferenceWei)

    log("Exchange rate from subgraph: %s", exchangeRate)
    log("Exchange rate calculated:     %s", BigInt(dataWeiBefore) * BigInt(1e36) / BigInt(totalSupplyBefore))

    const ownersTokensBefore = delegationsBefore[owner] ?? 0
    const ownersTokensAfter = delegationsAfter[owner] ?? 0

    // slashing first takes owner's tokens
    // if there are any left, then delegators didn't lose anything (yet)
    // the whole slashing will then be allocated to the owner
    if (ownersTokensAfter > 0) {
        return [{
            operator: slashingEvent.operator,
            operatorName: metadata.name,
            owner,
            totalOperatorTokensBeforeWei: totalSupplyBefore,
            delegatorsOperatorTokensBeforeWei: ownersTokensBefore,
            delegator: owner,
            delegatorDataLostWei: slashingEvent.amount,
        }]
    }

    log("Owner lost %s operator tokens", slashedOperatorTokens[owner])
    const ownerLoss = mul(slashedOperatorTokens[owner], exchangeRate)
    log("Owner lost %s DATA", ownerLoss)
    const delegatorTotalLoss = slashingEvent.amount - ownerLoss
    const delegatorList = Object.entries(delegationsBefore).filter(([ delegator ]) => delegator !== owner)
    const delegatorTotalTokens = delegatorList.reduce((acc, [ _delegator, tokens ]) => acc + tokens, BigInt(0))
    const delegatorSlashings = delegatorList.map(([ delegator, tokens ]) => ({
        operator: slashingEvent.operator,
        operatorName: metadata.name,
        owner,
        totalOperatorTokensBeforeWei: totalSupplyBefore,
        delegatorsOperatorTokensBeforeWei: tokens,
        delegator,
        delegatorDataLostWei: delegatorTotalLoss * tokens / delegatorTotalTokens,
    }))
    delegatorSlashings.sort((a, b) => a.delegator.localeCompare(b.delegator))

    return [{
        operator: slashingEvent.operator,
        operatorName: metadata.name,
        owner,
        totalOperatorTokensBeforeWei: totalSupplyBefore,
        delegatorsOperatorTokensBeforeWei: ownersTokensBefore,
        delegator: owner,
        delegatorDataLostWei: ownerLoss,
    }, ...delegatorSlashings]
}

async function main() {
    const slashings = await getSlashings()
    log("Got %d slashings", slashings.length)
    log("%o", slashings[0])
    const rows = await Promise.all(slashings.map(splitSlashing))
    log("Got %d rows", rows.flat().length)
    log("%o", rows[0][0])
    if (OUTPUT_FILE) {
        const headerString = "OperatorId;OperatorName;Owner;TotalOperatorTokens;DelegatorsOperatorTokens;Delegator;DelegatorDataLost\n"
        const rowsString = rows.flat().map((row) => Object.values(row).join(";")).join("\n")
        writeFileSync(OUTPUT_FILE, headerString)
        writeFileSync(OUTPUT_FILE, rowsString, { flag: "a" })
    }
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
