#!/usr/bin/env npx ts-node

/**
 * Run analyzeSlashings first, also download token data from polygonscan
 * https://polygonscan.com/exportData?type=tokentxnsbyaddress&contract=0x3a9a81d576d83ff21f26f325066054540720fc34
 *   &a=0x63f74a64fd334122ab5d29760c6e72fb4b752208&decimal=18
 */

import { readFileSync, writeFileSync } from "fs"
import type { SlashingRow } from "./analyzeSlashings"

const {
    SLASHINGS = "/Users/jtakalai/Documents/workspace/network-contracts/packages/network-contracts/scripts/data/slashings.csv",
    TRANSFERS = "/Users/jtakalai/Documents/workspace/network-contracts/packages/network-contracts/scripts/data/protocol-fee-transfers.csv",
    OUTPUT_FILE = "/Users/jtakalai/Documents/workspace/network-contracts/packages/network-contracts/scripts/data/protocol-fee-transfers-analyzed.csv",
    // SLASHINGS = "scripts/data/slashings.csv",
    // TRANSFERS = "scripts/data/protocol-fee-transfers.csv",
    // OUTPUT_FILE = "scripts/data/protocol-fee-transfers-analyzed.csv",
} = process.env

// OperatorId;OperatorName;Timestamp;BlockNumber;Owner;TotalOperatorTokens;DelegatorsOperatorTokens;Delegator;DelegatorDataLost
const slashingsRaw = readFileSync(SLASHINGS, "utf-8").split("\n").slice(1)
// "Txhash","Blockno","UnixTimestamp","DateTime (UTC)","From","To","Quantity","Method"
const transfersRaw = readFileSync(TRANSFERS, "utf-8").split("\n").slice(1)

const slashingsBySponsorship: Record<string, SlashingRow[]> = {}
slashingsRaw.forEach((lineRaw) => {
    const line = lineRaw.split(";")
    if (line.length < 10) { return }
    const sponsorship = line[9]
    if (!slashingsBySponsorship[sponsorship]) {
        slashingsBySponsorship[sponsorship] = []
    }
    slashingsBySponsorship[sponsorship].push({
        operator: line[0],
        operatorName: line[1],
        date: parseInt(line[2]),
        blockNumber: parseInt(line[3]),
        owner: line[4],
        totalOperatorTokensBeforeWei: BigInt(line[5]),
        delegatorsOperatorTokensBeforeWei: BigInt(line[6]),
        delegator: line[7],
        delegatorDataLostWei: BigInt(line[8]),
        sponsorship,
    })
})

// enrich transfers with info about corresponding slashing
writeFileSync(OUTPUT_FILE, "Txhash;Blockno;UnixTimestamp;DateTimeUTC;From;To;Quantity;Method;Operator;OperatorName;Delegator;DelegatorDataLost\n")
let foundTransfers = 0
let foundSlashings = 0
transfersRaw.forEach((lineRaw) => {
    const line = lineRaw.split("\",\"").map((part) => part.replace(/[",\r]/g, ""))
    const blockNumber = parseInt(line[1])
    const timestamp = parseInt(line[2])
    const sponsorship = line[4]
    const sbs = slashingsBySponsorship[sponsorship] || []
    const slashings = sbs.filter((slashing) => slashing.blockNumber === blockNumber)
    if (slashings.length > 0) {
        foundTransfers += 1
        foundSlashings += slashings.length
        slashings.forEach((slashing) => {
            if (slashing.date !== timestamp) {
                console.log("Mismatched timestamp: slashings has %s, transfers has %s", slashing.date, timestamp)
            }
            writeFileSync(
                OUTPUT_FILE,
                line.join(";") +
                    `;${slashing.operator};${slashing.operatorName}` +
                    `;${slashing.delegator};${slashing.delegatorDataLostWei}\n`,
                { flag: "a" }
            )
        })
    } else {
        writeFileSync(OUTPUT_FILE, line.join(";") + "\n", { flag: "a" })
    }
})

console.log("Found %s slashings in %s/%s transfers", foundSlashings, foundTransfers, transfersRaw.length)
