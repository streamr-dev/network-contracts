#!/usr/bin/env npx ts-node

/**
 * This script was written to find out how much DATA was slashed during RECOVERY of tokens that were locked in Operator version 1 contracts.
 *   Ticket is https://linear.app/streamr/issue/ETH-750/script-for-computing-returned-slashed-tokens
 * Operator version 1 unfortunately misallocated tokens after kick (did not slash owner's self-delegation),
 *   so while this script performed as expected, the results were off in sponsorships that had had kick-slashings.
 *   This was fixed in https://linear.app/streamr/issue/ETH-754/selfdelegation-slashing-in-operatoronkick
 */

import fetch from "node-fetch"
import { writeFileSync } from "fs"

import { Logger, TheGraphClient } from "@streamr/utils"
import { config } from "@streamr/config"

import { dateToBlockNumber, loadCache } from "./utils/dateToBlockNumberPolygonApi"
import { mul } from "./utils/bigint"

const { log } = console

const {
    START = "1709733209",
    END,

    // KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    CHAIN = "polygon",
    // ETHEREUM_RPC,
    // GAS_PRICE_GWEI,
    GRAPH_URL,

    OUTPUT_FILE = "scripts/data/slashings.csv",
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
    operatorContractVersion: string
    sponsorship: string
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
            contractVersion
          }
          sponsorship {
            id
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
        operatorContractVersion: e.operator.contractVersion,
        sponsorship: e.sponsorship?.id,
    }))
}

export type SlashingRow = {
    /** contract address */
    operator: string
    operatorName: string
    date: number
    blockNumber: number
    owner: string
    totalOperatorTokensBeforeWei: bigint
    delegatorsOperatorTokensBeforeWei: bigint
    delegator: string
    delegatorDataLostWei: bigint
    sponsorship: string
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
        operatorTokenTotalSupplyWei: totalSupplyBeforeRaw,
        // valueWithoutEarnings: dataWeiBefore,
        owner,
        exchangeRate, // DATA / operator token
        metadataJsonString,
    } } = res1
    const res2 = await graphClient.queryEntity<any>({ query: operatorAt(eventBlockNumber + 1) })
    const { operator: {
        delegations: delegationsAfterArray,
        // operatorTokenTotalSupplyWei: totalSupplyAfter,
        // valueWithoutEarnings: dataWeiAfter,
    } } = res2

    const totalSupplyBefore = BigInt(totalSupplyBeforeRaw)

    if (typeof exchangeRate !== "string" || isNaN(parseFloat(exchangeRate))) {
        throw new Error(`Bad exchange rate: "${exchangeRate}"`)
    }

    let metadata: any = { name: slashingEvent.operator }
    try {
        metadata = JSON.parse(metadataJsonString)
    } catch (e) {
        log("Failed to parse metadata string '%s'", metadataJsonString)
    }

    const delegationsBefore: [string, bigint][] = delegationsBeforeArray.map((d: any) => [
        d.delegator.id, BigInt(d.operatorTokenBalanceWei)
    ])
    const delegationsAfter: [string, bigint][] = delegationsAfterArray.map((d: any) => [
        d.delegator.id, BigInt(d.operatorTokenBalanceWei)
    ])

    let selfDelegationBefore = BigInt(0)
    let selfDelegationAfter = BigInt(0)
    const slashedOperatorTokens = delegationsBefore.map<[string, bigint]>(([delegator, before]) => {
        const after = delegationsAfter.find(([address, _]) => address === delegator)?.[1] ?? BigInt(0)
        if (delegator === owner) {
            selfDelegationBefore = before
            selfDelegationAfter = after
        }
        return [delegator, before - after]
    }).filter(([_, slashed]) => slashed > BigInt(0))
    log("Slashed operator tokens: %o", slashedOperatorTokens)

    const totalTokens = delegationsBefore.reduce((acc, [ _delegator, tokens ]) => acc + tokens, BigInt(0))
    log("Total operator tokens before slashing: %s, %s", totalTokens, totalSupplyBefore)

    // for contractVersion < 3, the self-delegation burning was omitted on kick
    // this means the losses were borne on all delegators equally, return in straight proportion to operator tokens
    if (slashedOperatorTokens.length === 0) {
        log("No operator tokens slashed, operator version: %s", slashingEvent.operatorContractVersion)
        const losses = delegationsBefore.map(([ delegator, tokens ]) => ({
            operator: slashingEvent.operator,
            operatorName: metadata.name,
            date: slashingEvent.date,
            blockNumber: eventBlockNumber,
            owner,
            totalOperatorTokensBeforeWei: totalSupplyBefore,
            delegatorsOperatorTokensBeforeWei: tokens,
            delegator,
            delegatorDataLostWei: slashingEvent.amount * tokens / totalSupplyBefore,
            sponsorship: slashingEvent.sponsorship,
        }))
        losses.sort((a, b) => a.delegator.localeCompare(b.delegator))
        return losses
    }

    if (slashedOperatorTokens.length > 1) {
        // throw new Error("Unexpected: Multiple delegators slashed")
        log("---------------------------------------")
        log("Unexpected: Multiple delegators slashed")
        log("---------------------------------------")
        log("Slashing event: %o", slashingEvent)
        log("Query before: %o", res1)
        log("Query after: %o", res2)
        return []
    }
    if (slashedOperatorTokens[0][0] !== owner) {
        // throw new Error("Unexpected: Non-owner slashed")
        log("-----------------------------")
        log("Unexpected: Non-owner slashed")
        log("-----------------------------")
        log("Slashing event: %o", slashingEvent)
        log("Query before: %o", res1)
        log("Query after: %o", res2)
        return []
    }
    const slashedSelfDelegation = slashedOperatorTokens[0][1]

    // slashing first takes owner's tokens
    // if there are any left, then delegators didn't lose anything (yet), because
    //   the whole slashing would then have been allocated to the owner
    // if there are none left, then all delegators took the remaining DATA value loss, in proportion to their tokens
    const ownerSlashing: SlashingRow = {
        operator: slashingEvent.operator,
        operatorName: metadata.name,
        date: slashingEvent.date,
        blockNumber: eventBlockNumber,
        owner,
        totalOperatorTokensBeforeWei: totalSupplyBefore,
        delegatorsOperatorTokensBeforeWei: selfDelegationBefore,
        delegator: owner,
        delegatorDataLostWei: mul(slashedSelfDelegation, exchangeRate),
        sponsorship: slashingEvent.sponsorship,
    }
    let delegatorSlashings: SlashingRow[] = []
    if (selfDelegationAfter === BigInt(0)) {
        log("Owner lost ALL %s operator tokens", slashedSelfDelegation)
        log("Owner lost %s DATA", ownerSlashing.delegatorDataLostWei)
        const delegatorTotalLoss = slashingEvent.amount - ownerSlashing.delegatorDataLostWei
        const delegatorList = delegationsBefore.filter(([ delegator ]) => delegator !== owner)
        const delegatorTotalTokens = delegatorList.reduce((acc, [ _delegator, tokens ]) => acc + tokens, BigInt(0))
        delegatorSlashings = delegatorList.map(([ delegator, tokens ]) => ({
            operator: slashingEvent.operator,
            operatorName: metadata.name,
            date: slashingEvent.date,
            blockNumber: eventBlockNumber,
            owner,
            totalOperatorTokensBeforeWei: totalSupplyBefore,
            delegatorsOperatorTokensBeforeWei: tokens,
            delegator,
            delegatorDataLostWei: delegatorTotalLoss * tokens / delegatorTotalTokens,
            sponsorship: slashingEvent.sponsorship,
        }))
    } else {
        log("Owner lost %s operator tokens, left with %s", slashedSelfDelegation, selfDelegationAfter)
        // correct the owner's slashing to "all of DATA lost", to avoid rounding errors
        ownerSlashing.delegatorDataLostWei = slashingEvent.amount
    }

    const allSlashings = [ownerSlashing, ...delegatorSlashings]

    allSlashings.sort((a, b) => a.delegator.localeCompare(b.delegator))
    log("DONE %s %s (%s rows)", slashingEvent.operator, doneSlashings++, allSlashings.length)
    return allSlashings
}

let doneSlashings = 0

async function main() {
    const slashings = await getSlashings()
    log("Got %d slashings", slashings.length)
    log("%o", slashings[0])
    await loadCache()

    const shortOutputFileName = OUTPUT_FILE + ".short.csv"
    const transferOutputFileName = OUTPUT_FILE + ".transfers.csv"
    log("Writing to %s and %s", OUTPUT_FILE, shortOutputFileName)
    const headerString = "OperatorId;OperatorName;Timestamp;BlockNumber;" +
    "Owner;TotalOperatorTokens;DelegatorsOperatorTokens;Delegator;DelegatorDataLost;Sponsorship\n"
    writeFileSync(OUTPUT_FILE, headerString)
    writeFileSync(shortOutputFileName, "") // empty the short-form file
    writeFileSync(transferOutputFileName, "") // empty the short-form file

    for (const slashing of slashings) {
        const transferString = `${slashing.date},${slashing.sponsorship},${slashing.amount},${slashing.operator}`
        writeFileSync(transferOutputFileName, transferString + "\n", { flag: "a" })

        const rows = await splitSlashing(slashing)
        if (rows.length === 0) { continue }
        const rowsString = rows.flat().map((row) => Object.values(row).join(";")).join("\n") + "\n"
        log(headerString)
        log(rowsString)
        writeFileSync(OUTPUT_FILE, rowsString, { flag: "a" })

        const shortRowsString = rows.flat().map((s) => `${s.delegator},${s.delegatorDataLostWei}`).join("\n") + "\n"
        writeFileSync(shortOutputFileName, shortRowsString, { flag: "a" })
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
