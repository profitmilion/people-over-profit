import React from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import { SectionFrame } from "../components/SectionFrame";

function SectionDots() {
    return (
        <div className="flex justify-center py-2">
            <span className="text-slate-600 text-sm tracking-[0.5em]">
                • • •
            </span>
        </div>
    );
}

const Pop33Landing: React.FC = () => {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
            <main className="mx-auto flex max-w-5xl flex-col gap-20 px-4 py-16 md:px-6 md:py-20 flex-1">
                {/* HERO – główne wejście do demo */}
                <SectionFrame className="grid gap-12 min-[1600px]:grid-cols-2 min-[1600px]:items-center">
                    {/* Lewa kolumna */}
                    <div className="space-y-7">
                        <div className="inline-flex items-center rounded-full bg-slate-900/80 px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                            POP33 Demo / People Over Profit
                        </div>

                        <div className="space-y-4">
                            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
                                One simple lottery &amp; crowdfunding flow
                            </h1>

                            <p className="max-w-xl text-sm leading-relaxed text-slate-300">
                                POP33 is a transparent model built around one repeatable flow:
                                join the round, wait for the daily draw, see the result. This
                                The main demo now uses the POP33 contract on Base Sepolia.
                                Farcaster integration and the full-scale PMN economy remain
                                future development areas.
                            </p>
                        </div>

                        <div className="h-4" />

                        {/* Kluczowe liczby / USP */}
                        <div className="grid gap-4 sm:grid-cols-3">
                            <InfoTile
                                label="Entry levels (beta)"
                                value="0.33 – 3.33 – 13.33 – 33 USDC"
                                note="We start low and move toward 33 USDC only when the community is ready."
                            />
                            <InfoTile
                                label="Draw rhythm"
                                value="30 draws / month"
                                note="The vision: a simple daily draw in one global structure."
                            />
                            <InfoTile
                                label="Transparent archive"
                                value="Visible winners"
                                note="Results stay available in a public-style archive inside the app."
                            />
                        </div>

                        {/* GŁÓWNE CTA – POP IT */}
                        <div className="mt-6 flex flex-col items-center gap-3 min-[1600px]:items-start">
                            <Link to="/demo" className="block min-w-0 w-full max-w-sm sm:w-auto">
                                <Button
                                    variant="pop"
                                    type="button"
                                    className="min-w-0 w-full whitespace-normal px-4 text-center text-sm sm:w-auto sm:px-10 sm:text-base"
                                >
                                    POP IT - open Base Sepolia demo
                                </Button>
                            </Link>

                            <p className="max-w-xs text-center text-[11px] text-slate-500 min-[1600px]:text-left mt-1">
                                Base Sepolia testnet only. No real funds are used. The local
                                browser simulation is available separately as a developer tool.
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
                                    description="Connect a supported wallet and switch it to Base Sepolia before using the on-chain POP IT action."
                                />
                                <StepRow
                                    title="Wait for the draw"
                                    description="The current testnet contract records the entry. Complete production payments and draw mechanics are still under development."
                                />
                                <StepRow
                                    title="See results & archive"
                                    description="On-chain statistics are shown in the main demo. The local cycle archive belongs only to the separate DEV simulation."
                                />
                                
                            </div>
                        </div>
                    </div>
                </SectionFrame>

                {/* GŁÓWNA SEKCJA MARKETINGOWA – wizja + korzyści */}
                <SectionFrame className="space-y-6 px-4 py-6 md:px-6 md:py-8">
                    <div className="space-y-3">
                        <h2 className="text-xl font-semibold tracking-tight">
                            Why POP33 can become a community-scale win model
                        </h2>

                        <SectionDots />

                        <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
                            POP33 is not just a lottery. It is a social-economic model built
                            on fairness, shared value and transparent mechanics. The full
                            vision only activates if we reach a real community cap and all
                            conditions are met – but the direction is clear from day one.
                        </p>
                    </div>

                    {/* Duża karta – wizja / warunkowe obietnice */}
                    <div className="mt-2 rounded-2xl bg-slate-900/85 p-4 shadow-sm md:p-5 space-y-2">
                        <p className="text-sm font-semibold text-slate-50">
                            Vision: million-scale community economy
                        </p>
                        <p className="text-xs leading-relaxed text-slate-300">
                            If POP33 reaches the required cap and all conditions are met, the
                            full model may unlock: up to 1 000 000 USD monthly for winners,
                            sponsored free tickets for observers, ecosystem rewards for
                            long-term participants and a growing PMN Profit Milion economy.
                            This is a vision, not a guarantee, and it depends entirely on
                            real adoption.
                        </p>
                    </div>

                    {/* 4 mniejsze karty – konkretne korzyści */}
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <StepCard
                            title="Fair by design"
                            body="POP33 removes typical gambling traps: no VIP tiers, no endless upgrades, no uncontrolled spending. Everyone in a round has the same simple chance."
                        />
                        <StepCard
                            title="Free tickets for observers"
                            body="A small portion of every paid ticket can fund free entries for people who watch from the side. They can still join, play and win – even with zero balance."
                        />
                        <StepCard
                            title="HODL & DCA potential"
                            body="Parts of the model are planned to support long-term DCA / HODL mechanics for loyal users. Exact rules and risks will be described in the Whitepaper and Manifest."
                        />
                        <StepCard
                            title="Scaling with users"
                            body="We start with very small entry levels and only move toward the final 33 USDC tier when the community size and on-chain activity make it realistic and safe."
                        />
                    </div>

                    {/* DRUGIE CTA – mocniej wyeksponowane, z większym odstępem */}
                    <div className="mt-10 mb-12 flex justify-center md:justify-start">
                        <Link to="/demo">
                            <Button variant="pop" type="button">
                                POP IT - open Base Sepolia demo
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
