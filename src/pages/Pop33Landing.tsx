import React from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import { SectionFrame } from "../components/SectionFrame";

const Pop33Landing: React.FC = () => {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
            <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-20 px-4 py-16 md:px-6 md:py-20 flex-1">
                {/* HERO – główne wejście do demo */}
                <SectionFrame className="grid gap-12 min-[1600px]:grid-cols-2 min-[1600px]:items-center">
                    {/* Lewa kolumna */}
                    <div className="space-y-7">
                        <div className="inline-flex items-center rounded-full bg-slate-900/80 px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                            POP33 Demo V1 · Base Sepolia
                        </div>

                        <div className="space-y-4">
                            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
                                One on-chain pool. Ten test rounds.
                            </h1>

                            <p className="mx-auto max-w-xl text-center text-sm leading-relaxed text-slate-300">
                                Demo V1 is the current POP33 product flow on Base Sepolia:
                                connect a wallet, use valueless test dUSDC to join a
                                100-position pool, follow ten scheduled rounds and inspect
                                the results on-chain.
                            </p>
                        </div>

                        <div className="h-4" />

                        {/* Kluczowe liczby / USP */}
                        <div className="grid gap-4 sm:grid-cols-3">
                            <InfoTile
                                label="Test position"
                                value="33 dUSDC"
                                note="POP33 Demo USD is a valueless test token, not real USDC."
                            />
                            <InfoTile
                                label="Pool"
                                value="100 positions"
                                note="A full test pool holds 3,300 dUSDC in on-chain escrow."
                            />
                            <InfoTile
                                label="Test rounds"
                                value="10 × 330 dUSDC"
                                note="One winner per round on a shortened hourly test schedule."
                            />
                        </div>

                        {/* GŁÓWNE CTA – POP IT */}
                        <div className="mt-6 flex flex-col items-center gap-3 min-[1600px]:items-start">
                            <Link to="/demo-v1" className="block min-w-0 w-full max-w-sm sm:w-auto">
                                <Button
                                    variant="pop"
                                    type="button"
                                    className="min-w-0 w-full whitespace-normal px-4 text-center text-sm sm:w-auto sm:px-10 sm:text-base"
                                >
                                    POP IT - open Demo V1
                                </Button>
                            </Link>

                            <p className="max-w-xs text-center text-[11px] text-slate-500 min-[1600px]:text-left mt-1">
                                Base Sepolia only. No real funds or real prizes. Winner
                                selection uses explicitly non-production test randomness.
                            </p>
                        </div>
                    </div>

                    {/* Prawa kolumna – 3 kroki skrócone */}
                    <div className="relative">
                        <div className="absolute inset-0 -translate-y-2 translate-x-2 rounded-3xl bg-gradient-to-br from-emerald-500/25 via-sky-500/15 to-orange-500/25 blur-2xl" />
                        <div className="relative rounded-3xl bg-slate-900/90 p-6 shadow-2xl sm:p-8">
                            <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                How the Base Sepolia demo works
                            </p>

                            <div className="mt-4 space-y-5">
                                <StepRow
                                    title="Connect on Base Sepolia"
                                    description="Connect a supported wallet, switch to Base Sepolia and make sure it has test ETH for gas."
                                />
                                <StepRow
                                    title="Get dUSDC and join"
                                    description="Use the test-token faucet, approve exactly 33 dUSDC and create one on-chain position in an available pool."
                                />
                                <StepRow
                                    title="Follow rounds and claims"
                                    description="A full pool has ten scheduled test rounds. Winners claim 330 dUSDC, and the on-chain archive shows the recorded results."
                                />
                            </div>
                        </div>
                    </div>
                </SectionFrame>

                {/* ODDZIELONA SEKCJA PRZYSZŁEJ WIZJI */}
                <SectionFrame className="space-y-6 px-4 py-6 md:px-6 md:py-8">
                    <div className="space-y-3">
                        <div className="inline-flex rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300">
                            Future product vision · not part of Demo V1
                        </div>
                        <h2 className="text-xl font-semibold tracking-tight">
                            Where POP33 may evolve after the testnet demo
                        </h2>

                        <p className="mx-auto max-w-2xl text-center text-sm leading-relaxed text-slate-300">
                            POP33 is intended to become a transparent, community-oriented
                            product on Base. Mainnet economics, production randomness,
                            automation, eligibility and any broader community mechanisms
                            remain future work and require separate decisions.
                        </p>
                    </div>

                    <div className="mt-2 rounded-2xl bg-slate-900/85 p-4 shadow-sm md:p-5 space-y-2">
                        <p className="text-sm font-semibold text-slate-50">
                            Current boundary
                        </p>
                        <p className="text-xs leading-relaxed text-slate-300">
                            Demo V1 is a Base Sepolia lifecycle test with dUSDC that has no
                            monetary value. It is not a Mainnet product, does not offer real
                            prizes and does not prove production-grade randomness or
                            automation.
                        </p>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <StepCard
                            title="Future Mainnet product"
                            body="Real assets, release controls and operating rules require separate product, legal and security approval."
                        />
                        <StepCard
                            title="Production randomness"
                            body="The current permissionless draw is for testing only. A verifiable production mechanism remains to be selected."
                        />
                        <StepCard
                            title="Community scale"
                            body="The long-term scale and community model are a direction, not functionality available in Demo V1."
                        />
                    </div>

                    {/* DRUGIE CTA – mocniej wyeksponowane, z większym odstępem */}
                    <div className="mt-10 mb-12 flex justify-center">
                        <Link to="/demo-v1">
                            <Button variant="pop" type="button">
                                POP IT - open Demo V1
                            </Button>
                        </Link>
                    </div>
                </SectionFrame>
            </main>

            {/* Mały footer na samym dole */}
            <footer className="border-t border-slate-900 py-3 text-center text-[11px] text-slate-600">
                Created by ProfitMilion
            </footer>
        </div>
    );
};

type StepRowProps = {
    title: string;
    description: string;
};

const StepRow: React.FC<StepRowProps> = ({ title, description }) => {
    return (
        <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-50">{title}</p>
            <p className="text-[12px] leading-relaxed text-slate-400">
                {description}
            </p>
        </div>
    );
};

type StepCardProps = {
    title: string;
    body: string;
};

const StepCard: React.FC<StepCardProps> = ({ title, body }) => {
    return (
        <div className="flex flex-col gap-2 rounded-2xl bg-slate-900/85 p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-50">{title}</p>
            <p className="text-xs leading-relaxed text-slate-300">{body}</p>
        </div>
    );
};

type InfoTileProps = {
    label: string;
    value: string;
    note: string;
};

const InfoTile: React.FC<InfoTileProps> = ({ label, value, note }) => {
    return (
        <div className="rounded-2xl bg-slate-900/85 px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium text-slate-400">{label}</p>
            <p className="text-lg font-semibold text-slate-50">{value}</p>
            <p className="mt-1 text-[11px] text-slate-400">{note}</p>
        </div>
    );
};

export default Pop33Landing;
