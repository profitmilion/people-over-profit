import React from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";

function SectionDots() {
    return (
        <div className="flex justify-center py-2">
            <span className="text-slate-600 text-sm tracking-[0.5em]">
                • • •
            </span>
        </div>
    );
}

function MiniDots() {
    return (
        <div className="flex justify-center my-2">
            <span className="text-slate-600 text-[9px] tracking-[0.25em]">
                • • •
            </span>
        </div>
    );
}


const Pop33Landing: React.FC = () => {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-50">
            <main className="mx-auto flex max-w-5xl flex-col gap-20 px-4 py-16 md:px-6 md:py-20">
                {/* HERO – główne wejście do demo */}
                <section className="grid gap-12 md:grid-cols-2 md:items-center">
                    {/* Lewa kolumna */}
                    <div className="space-y-7">
                        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            POP33 Demo • People Over Profit
                        </div>

                        <div className="space-y-4">
                            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
                                One simple lottery & crowdfunding flow
                            </h1>

                            {/* kropki tylko jako akcent pod głównym tytułem */}
                            <SectionDots />

                            <p className="max-w-xl text-sm leading-relaxed text-slate-300">
                                POP33 is a transparent model that anyone can understand.
                                Instead of a complicated gambling experience, this demo shows
                                one repeatable flow: enter, wait for the draw, see the result.
                            </p>
                            <MiniDots />
                        </div>

                        {/* lekką przerwę robimy odstępem, nie kropkami */}
                        <div className="h-4" />

                        {/* Kluczowe liczby / USP */}
                        <div className="grid gap-4 sm:grid-cols-3">
                            <InfoTile
                                label="Entry (future)"
                                value="33 USDC"
                                note="In the live version: a single, simple entry to each cycle."
                            />
                            <MiniDots />
                            <InfoTile
                                label="Rhythm"
                                value="30 draws / month"
                                note="Target: daily draws in one global structure."
                            />
                            <MiniDots />
                            <InfoTile
                                label="Transparency"
                                value="Visible winners"
                                note="Results stay available in a public-style archive."
                            />

                        </div>

                        {/* GŁÓWNE CTA – POP IT */}
                        <div className="mt-6 flex flex-col items-center gap-3 md:items-start">
                            <Link to="/demo">
                                <Button variant="pop" type="button">
                                    POP IT - start demo
                                </Button>
                            </Link>

                            {/* tutaj zamiast kropek dajemy po prostu oddech */}
                            <p className="max-w-xs text-center text-[11px] text-slate-500 md:text-left mt-1">
                                This is a front-end demo only. No real funds are used here.
                                The goal is to preview the user journey before we connect
                                smart contracts on Base and a Farcaster Miniapp.
                            </p>
                            <MiniDots />
                        </div>
                    </div>

                    {/* Prawa kolumna – 3 kroki skrócone, BEZ NUMERKÓW */}
                    <div className="relative">
                        <div className="absolute inset-0 -translate-y-2 translate-x-2 rounded-3xl bg-gradient-to-br from-emerald-500/25 via-sky-500/15 to-orange-500/25 blur-2xl" />
                        <div className="relative rounded-3xl bg-slate-900/90 p-6 shadow-2xl sm:p-8">
                            <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                How this demo works
                            </p>

                            {/* delikatny akcent pod nagłówkiem sekcji */}
                            <SectionDots />

                            <div className="mt-4 space-y-5">
                                <StepRow
                                    title="Enter the demo cycle"
                                    description="The user joins the active cycle. In this version we simulate the entry – no wallet, no real USDC."
                                />
                                <MiniDots />
                                <StepRow
                                    title="Demo draw is triggered"
                                    description="When the cycle logic is ready, a demo draw assigns winners to that cycle using deterministic rules."
                                />
                                <MiniDots />
                                <StepRow
                                    title="Results stay visible"
                                    description="Closed demo cycles can be browsed in the winners view, so you can see how the structure behaves over time."
                                />
                                <MiniDots />
                            </div>


                        </div>
                    </div>
                </section>

                {/* separator między HERO a kolejną sekcją */}


                {/* SEKCJA POD HERO – 3 kroki opisane szerzej, BEZ NUMERKÓW */}
                <section className="space-y-6 rounded-3xl bg-slate-900/60 px-4 py-6 md:px-6 md:py-8">
                    <div className="space-y-3">
                        <h2 className="text-xl font-semibold tracking-tight">
                            A transparent model that everyone can follow
                        </h2>

                        <SectionDots />

                        <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
                            POP33 is not about hiding mechanics behind complex dashboards.
                            It is about a simple structure that can be explained in a few
                            sentences and repeated every day in the same way.
                        </p>
                    </div>
                    <MiniDots />
                    <div className="mt-3 grid gap-4 md:grid-cols-3">
                        <StepCard
                            title="Click POP IT"
                            body="From the landing page you enter the demo cycle. This is what a real user would do in the live version."
                        />
                        <MiniDots />
                        <StepCard
                            title="Follow the cycle"
                            body="The cycle advances through its stages until the draw happens. In production this will be fully on-chain."
                        />
                        <MiniDots />
                        <StepCard
                            title="Check the outcome"
                            body="After closing a cycle, results stay accessible so you can understand how winners were distributed over time."
                        />
                    </div>
                </section>

                {/* separator przed sekcją zwycięzców */}
                <SectionDots />

                {/* TEASER ZWYCIĘZCÓW */}
                <section className="space-y-3 rounded-3xl bg-slate-900/60 px-4 py-5 text-sm shadow-sm md:flex md:items-center md:justify-between md:space-y-0 md:px-6">
                    <div className="max-w-xl space-y-2">
                        <p className="text-sm font-semibold text-slate-100">
                            See winners (demo)
                        </p>

                        <p className="text-[11px] leading-relaxed text-slate-300">
                            This view lets you explore demo winners from previous cycles.
                            In the real POP33 product, this section will present actual
                            user wins and support community auditability.
                        </p>
                    </div>
                    <div className="mt-3 md:mt-0">
                        <Link
                            to="/archive"
                            className="inline-flex items-center justify-center rounded-full px-5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800 no-underline"
                        >
                            See winners (demo)
                        </Link>
                    </div>
                </section>
            </main>
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
