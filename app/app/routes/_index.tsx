import * as anchor from "@coral-xyz/anchor"
import { fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters"
import { json, type LoaderFunction, type MetaFunction } from "@vercel/remix"
import { Link, useLoaderData } from "@remix-run/react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useEffect, useState } from "react"
import { raffleProgram } from "~/helpers/raffle.server"
import { useRaffle } from "~/context/raffle"
import { useUmi } from "~/context/umi"
import { Card, CardBody, Image } from "@nextui-org/react"
import { RafflerWithPublicKey, Staker, StakerWithPublicKey } from "~/types/types"
import { useStake } from "~/context/stake"
import { PlusCircleIcon } from "@heroicons/react/24/outline"
import _ from "lodash"
import axios from "axios"
import { base64 } from "@metaplex-foundation/umi/serializers"

export const loader: LoaderFunction = async () => {
  console.log(raffleProgram.coder.accounts.memcmp("raffler"))
  const { data } = await axios.post(process.env.RPC_HOST!, {
    jsonrpc: "2.0",
    id: 1,
    method: "getProgramAccounts",
    params: [
      raffleProgram.programId.toBase58(),
      {
        encoding: "base64",
        filters: [
          {
            memcmp: raffleProgram.coder.accounts.memcmp("raffler"),
          },
        ],
      },
      //     {
      //       dataSize: 17,
      //     },
      //     {
      //       memcmp: {
      //         offset: 4,
      //         bytes: "3Mc6vR",
      //       },
      //     },
      //   ],
      // },
    ],
  })

  const rafflers = data.result.map((item: any) => {
    return {
      publicKey: item.pubkey,
      account: Buffer.from(item.account.data[0], "base64"),
    }
  })
  // raffleProgram.account.raffler.coder

  // // const rafflers = await raffleProgram.provider.connection.getProgramAccounts(raffleProgram.programId)
  // const rafflers = _.orderBy(await raffleProgram.account.raffler.all(), [
  //   (r) => r.account.slug !== "xin_labs",
  //   (r) => r.account.slug !== "dandies",
  //   (r) => r.account.slug,
  // ])
  // return json({
  //   rafflers: await Promise.all(
  //     rafflers.map(async (r) => {
  //       return {
  //         publicKey: r.publicKey.toBase58(),
  //         account: await raffleProgram.coder.accounts.encode("raffler", r.account),
  //       }
  //     })
  //   ),
  // })
  // const res = await connection.getBalance(new anchor.web3.PublicKey("JCapwSzWyHkjuVrT5ZTyKwBHzV9oYrTNhZguAMc9PiEc"))
  // console.log({ res })
  return json({
    rafflers,
  })
}

export default function Index() {
  const [loading, setLoading] = useState(false)
  const wallet = useWallet()
  const umi = useUmi()
  const raffleProgram = useRaffle()
  const data = useLoaderData<typeof loader>()
  const rafflers: RafflerWithPublicKey[] = data.rafflers.map((r: any) => {
    return {
      publicKey: new anchor.web3.PublicKey(r.publicKey),
      account: raffleProgram.coder.accounts.decode("raffler", Buffer.from(r.account)),
    }
  })

  return (
    <div className="container m-x-auto">
      <div className="grid gap-4 grid-cols-3">
        {rafflers.map((raffler: RafflerWithPublicKey) => (
          <Raffler raffler={raffler} />
        ))}
        <Card>
          <CardBody className="flex items-center justify-center">
            <Link to="/create" className="flex flex-col items-center justify-center gap-2">
              <PlusCircleIcon className="text-primary w-10" />
              <p className="text-3xl font-bold uppercase text-primary">Create Raffler</p>
            </Link>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Raffler({ raffler }: { raffler: RafflerWithPublicKey }) {
  const [staker, setStaker] = useState<Staker | null>(null)
  const stakeProgram = useStake()

  useEffect(() => {
    if (!raffler.account.staker) {
      setStaker(null)
      return
    }

    ;(async () => {
      const staker = await stakeProgram.account.staker.fetch(raffler.account.staker!)
      setStaker(staker || null)
    })()
  }, [raffler.account.slug])

  return (
    <Link to={`/${raffler.account.slug}`}>
      <Card>
        {staker && staker.theme.logo !== null && (
          <div className="h-40 flex items-center justify-center">
            <img src={staker.theme.logos[staker.theme.logo]} className="p-10 max-h-full max-w-full" />
          </div>
        )}
        {/* <CardBody>{raffler.account.name}</CardBody> */}
      </Card>
    </Link>
  )
}
