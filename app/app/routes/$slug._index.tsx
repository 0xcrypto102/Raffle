import * as anchor from "@coral-xyz/anchor"
import { DigitalAsset, fetchDigitalAsset } from "@metaplex-foundation/mpl-token-metadata"
import { fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  Chip,
  CircularProgress,
  Image,
  Input,
  Tab,
  Tabs,
} from "@nextui-org/react"
import { LoaderFunction, json } from "@vercel/remix"
import { Link, useLoaderData, useOutletContext } from "@remix-run/react"
import { useWallet } from "@solana/wallet-adapter-react"
import axios from "axios"
import { DAS } from "helius-sdk"
import _, { omit } from "lodash"
import { useEffect, useRef, useState } from "react"
import { Countdown } from "~/components/Countdown"
import { RaffleStateChip } from "~/components/RaffleStateChip"
import { useDigitalAssets } from "~/context/digital-assets"
import { usePriorityFees } from "~/context/priority-fees"
import { useRaffle } from "~/context/raffle"
import { useUmi } from "~/context/umi"
import { entrantsFromUri, getRafflerFromSlug, imageCdn, isLive } from "~/helpers"
import { nativeMint } from "~/helpers/pdas"
import { getRaffleState } from "~/helpers/raffle-state"
import { raffleProgram } from "~/helpers/raffle.server"
import { buyTickets } from "~/helpers/txs"
import {
  Entrants,
  RaffleState,
  RaffleWithPublicKey,
  RaffleWithPublicKeyAndEntrants,
  RafflerWithPublicKey,
} from "~/types/types"
import { getMultipleAccounts, getProgramAccounts } from "~/helpers/index.server"
import { Prize } from "~/components/Prize"
import { adminWallet } from "~/constants"

export const loader: LoaderFunction = async ({ params, context }) => {
  const raffler = await getRafflerFromSlug(params.slug as string)
  if (!raffler) {
    throw new Response("Not found", { status: 404, statusText: "Not found" })
  }
  const raffles: RaffleWithPublicKey[] = await getProgramAccounts(
    raffleProgram,
    "raffle",
    [
      {
        memcmp: {
          bytes: raffler.publicKey.toBase58(),
          offset: 8,
        },
      },
    ],
    true
  )

  const entrants = await getMultipleAccounts(
    raffles.map((r) => r.account.entrants),
    "entrants",
    raffleProgram
  )

  return json({
    raffles: await Promise.all(
      raffles.map(async (raffle, index) => {
        return {
          publicKey: raffle.publicKey.toBase58(),
          account: await raffleProgram.coder.accounts.encode("raffle", raffle.account),
          entrants:
            entrants[index] ||
            (raffle.account.uri
              ? await raffleProgram.coder.accounts.decode("entrants", await entrantsFromUri(raffle.account.uri))
              : null),
        }
      })
    ),
  })
}

export default function Raffles() {
  const wallet = useWallet()
  const data = useLoaderData<typeof loader>()
  const raffleProgram = useRaffle()
  const raffler = useOutletContext<RafflerWithPublicKey>()
  const raffles: RaffleWithPublicKeyAndEntrants[] = data.raffles.map((r: any) => {
    return {
      publicKey: new anchor.web3.PublicKey(r.publicKey),
      account: raffleProgram.coder.accounts.decode("raffle", Buffer.from(r.account)),
      entrants: r.entrants,
    }
  })

  const grouped = _.groupBy(raffles, (raffle) => {
    const state = getRaffleState(omit(raffle, "entrants"), raffle.entrants)
    return state
  })

  const isAdmin =
    wallet.publicKey?.toBase58() === raffler.account.authority.toBase58() ||
    wallet.publicKey?.toBase58() === adminWallet

  return (
    <div className="flex flex-col gap-6 mt-10">
      <Tabs size="lg">
        <Tab title="Live">
          <Section label="Live" raffles={grouped[RaffleState.inProgress]} />
        </Tab>
        <Tab title="Ended">
          <Section
            label="Ended"
            raffles={[...(grouped[RaffleState.ended] || []), ...(grouped[RaffleState.drawn] || [])]}
          />
        </Tab>
        <Tab title="Upcoming">
          <Section label="Upcoming" raffles={grouped[RaffleState.notStarted]} />
        </Tab>
        <Tab title="Past">
          <Section label="Past" raffles={grouped[RaffleState.claimed]} />
        </Tab>
        {isAdmin && (
          <Tab title="Cancelled">
            <Section label="Cancelled" raffles={grouped[RaffleState.cancelled]} />
          </Tab>
        )}
      </Tabs>
    </div>
  )
}

function Section({ raffles = [], label }: { raffles: RaffleWithPublicKeyAndEntrants[]; label: string }) {
  return (
    <div className="mb-10">
      <h3 className="text-xl font-bold">{label} raffles:</h3>
      {raffles.length ? (
        <div className="grid gap-6 lg:grid-cols-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:gid-cols-5 mt-10">
          {raffles.map(({ entrants, ...raffle }) => {
            return <Raffle raffle={raffle} entrants={entrants} key={raffle.publicKey.toBase58()} />
          })}
        </div>
      ) : (
        <div className="flex justify-center items-center h-40">
          <p className="font-bold bg-background text-xl">No {label.toLowerCase()} raffles</p>
        </div>
      )}
    </div>
  )
}

function Raffle({
  raffle: initialRaffle,
  entrants: initialEntrants,
}: {
  raffle: RaffleWithPublicKey
  entrants: Entrants
}) {
  const wallet = useWallet()
  const [entrants, setEntrants] = useState<Entrants>(initialEntrants)
  const [raffle, setRaffle] = useState(initialRaffle)
  const { feeLevel } = usePriorityFees()
  const [loading, setLoading] = useState(false)
  const [numTickets, setNumTickets] = useState("")
  const program = useRaffle()
  const { digitalAssets, fetching } = useDigitalAssets()
  const umi = useUmi()
  const [token, setToken] = useState<DigitalAsset | null>(null)
  const [digitalAsset, setDigitalAsset] = useState<DAS.GetAssetResponse | null>(null)
  const raffleProgram = useRaffle()
  const [raffleState, setRaffleState] = useState<RaffleState>(RaffleState.notStarted)

  useEffect(() => {
    setRaffle(initialRaffle)
  }, [initialRaffle])

  useEffect(() => {
    if (!raffle.account.prize) {
      setDigitalAsset(null)
      return
    }

    ;(async () => {
      const { data } = await axios.get<{ digitalAsset: DAS.GetAssetResponse }>(
        `/api/get-nft/${raffle.account.prize.toBase58()}`
      )

      setDigitalAsset(data.digitalAsset)
    })()
  }, [raffle.account.prize])

  useEffect(() => {
    if (!raffle.account.paymentType.token?.tokenMint) {
      setToken(null)
      return
    }

    ;(async () => {
      const da = await fetchDigitalAsset(umi, fromWeb3JsPublicKey(raffle.account.paymentType.token?.tokenMint!))
      setToken(da)
    })()
  }, [raffle.account.paymentType.token?.tokenMint])

  useEffect(() => {
    if (!raffle.account.entrants) {
      return
    }

    async function getEntrants() {
      const entrantsAcc = await program.account.entrants.fetchNullable(raffle.account.entrants)
      if (entrantsAcc) {
        setEntrants(entrantsAcc)
      }
    }

    const id = raffleProgram.provider.connection.onAccountChange(raffle.account.entrants, getEntrants)

    return () => {
      raffleProgram.provider.connection.removeAccountChangeListener(id)
    }
  }, [raffle.account.entrants])

  const isSol = raffle.account.paymentType.token?.tokenMint.toBase58() === nativeMint
  const factor = isSol ? anchor.web3.LAMPORTS_PER_SOL : Math.pow(10, token?.mint.decimals || 0)

  const interval = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    function tick() {
      const state = getRaffleState(raffle, entrants)

      if (!isLive(state)) {
        clearInterval(interval.current)
      }

      setRaffleState(state)
    }
    tick()
    interval.current = setInterval(tick, 1000)

    return () => {
      clearInterval(interval.current)
    }
  }, [raffle.account.startTime, raffle.account.endTime, entrants])

  return (
    <Card>
      <Link to={`${raffle.publicKey.toBase58()}`}>
        <Prize raffle={raffle} raffleState={raffleState} entrants={entrants} />
      </Link>
      <CardBody>
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-lg font-bold truncate">{digitalAsset?.content?.metadata.name}</h3>
          </div>

          <div className="flex justify-between">
            <p>Entry price:</p>
            <p className="text-primary font-bold">
              {raffle.account.paymentType.nft
                ? "1 NFT"
                : `${(raffle.account.paymentType.token?.ticketPrice?.toNumber?.() || 0) / factor} ${
                    isSol ? "SOL" : token?.metadata.symbol || "$TOKEN"
                  }`}
            </p>
          </div>
          <div className="flex justify-between">
            <p>Tickets:</p>
            <p>
              {entrants?.total.toString() || 0} /{" "}
              {entrants?.max.toString() === "4294967295" ? "∞" : entrants?.max.toString() || 0}
            </p>
          </div>
          <>
            {raffleState === RaffleState.notStarted ? (
              <div className="flex items-end justify-start h-full">
                <div>
                  <p className="text-xs font-bold uppercase">Starts in</p>
                  <Countdown until={raffle.account.startTime.toNumber()} className="text-xl" compact urgent={false} />
                </div>
              </div>
            ) : (
              <div className="flex items-end justify-start h-full">
                <div>
                  <p className="text-xs font-bold uppercase">Ends in</p>
                  {(entrants?.total || 0) < (entrants?.max || 0) ? (
                    <Countdown until={raffle.account.endTime.toNumber()} className="text-xl" compact />
                  ) : (
                    <p className="text-xl">ENDED</p>
                  )}
                </div>
              </div>
            )}
          </>
        </div>
      </CardBody>
      <CardFooter>
        {raffleState === RaffleState.inProgress ? (
          <div className="flex gap-3 items-end justify-between">
            {raffle.account.paymentType.token && (
              <Input
                type="number"
                value={numTickets}
                onValueChange={(num) => setNumTickets(num)}
                label="Quantity"
                labelPlacement="outside"
                min={1}
                step={1}
              />
            )}

            <Button
              onClick={() =>
                buyTickets({
                  umi,
                  digitalAssets,
                  program,
                  fetching,
                  raffle,
                  numTickets,
                  onStart: () => setLoading(true),
                  onComplete: () => setLoading(false),
                  onSuccess: () => {},
                  feeLevel,
                })
              }
              isDisabled={!wallet.publicKey}
              color="primary"
            >
              Buy ticket{["0", "1", ""].includes(numTickets) ? "" : "s"}
            </Button>
          </div>
        ) : (
          <div className="flex justify-between w-full">
            <div />
            <Link to={`${raffle.publicKey.toBase58()}`}>
              <Button>View</Button>
            </Link>
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
