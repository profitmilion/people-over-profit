// src/pages/Pop33Landing.tsx

import React from "react";
import { useNavigate } from "react-router-dom";


export default function Pop33Landing() {
    const navigate = useNavigate();

    const goToDemoProd = () => navigate("/demo");
    const goToDemoDev = () => navigate("/demo?view=dev");

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">

            {/* NAVBAR */}
            <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
                <nav className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-500 to-violet-500 flex items-center justify-center text-xs font-bold">
                            POP
                        </div>
                        <div className="flex flex-col leading-tight">
                            <span className="text-sm font-semibold tracking-wide">
                                POP33 DEMO
                            </span>
                            <span className="text-[11px] text-slate-400">
                                People Over Profit · testnet
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            className="hidden sm:inline-flex items-center justify-center rounded-full border border-slate-700 px-4 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-900 transition"
                            onClick={goToDemoDev}
                        >
                            Zobacz jak to działa
                        </button>
                        <button
                            className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition"
                            onClick={goToDemoProd}
                        >
                            Wejdź do wersji DEMO
                        </button>

                    </div>
                </nav>
            </header>

            {/* MAIN */}
            <main className="flex-1">
                {/* HERO */}
                <section className="mx-auto max-w-5xl px-4 py-12 md:py-20">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/5 px-3 py-1 text-[11px] font-medium text-emerald-300 mb-4">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Eksperyment społeczny na testnecie Sepolia
                    </div>

                    <div className="grid gap-10 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-center">
                        <div>
                            <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight mb-4">
                                POP33 DEMO –{" "}
                                <span className="text-emerald-400">
                                    codziennie grasz o 1 000 000
                                </span>
                            </h1>

                            <p className="text-sm md:text-base text-slate-300 mb-3">
                                Docelowy model POP33 zakłada codzienną grę o 1 000 000 USDC.
                                W wersji DEMO trenujemy ten mechanizm na punktach testowych,
                                bez prawdziwych pieniędzy.
                            </p>

                            <p className="text-sm md:text-base text-slate-300 mb-6">
                                Wersja demonstracyjna loterii społecznościowej na blockchainie.
                                Bez prawdziwych pieniędzy, bez ryzyka. Testujemy mechanikę
                                People Over Profit i dzielimy się z społecznością pomysłem,
                                możliwościami, wartościami, które nam towarzyszą oraz
                                wynikami testów. Mamy wiele dodatków i planów, które w
                                przyszłości chcemy rozwijać wspólnie ze społecznością.
                            </p>

                            <div className="flex flex-wrap items-center gap-3 mb-4">
                                <button
                                    className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition"
                                    onClick={goToDemoProd}
                                >
                                    Wejdź do wersji DEMO
                                </button>
                                <button
                                    className="inline-flex items-center justify-center rounded-full border border-slate-700 px-6 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-900 transition"
                                    onClick={goToDemoDev}
                                >
                                    Zobacz jak to działa
                                </button>

                            </div>

                            <p className="text-[11px] text-slate-400">
                                To środowisko testowe. Nie przyjmujemy realnych depozytów.
                                Celem jest dopracowanie logiki cykli, limitów i losowań,
                                zanim projekt trafi na mainnet.
                            </p>

                            <p className="mt-2 text-[11px] text-slate-400">
                                Więcej o idei POP33 i kampanii „Ludzie ponad zysk” przeczytasz na{" "}
                                <a
                                    href="https://profitmilion.com"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                                >
                                    ProfitMilion.com
                                </a>
                                .
                            </p>

                        </div>

                        {/* Podgląd karty DEMO */}
                        <div className="md:justify-self-end">
                            <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-900 to-slate-950 p-5 shadow-xl shadow-emerald-500/15">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <p className="text-[11px] text-slate-400 mb-1">
                                            Aktywny cykl
                                        </p>
                                        <p className="text-sm font-semibold">
                                            POP33 · DEMO Cycle #07
                                        </p>
                                    </div>
                                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-300 border border-emerald-500/40">
                                        Testnet only
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                                    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                                        <p className="text-[11px] text-slate-400 mb-1">
                                            Cel modelu
                                        </p>
                                        <p className="text-sm font-semibold text-emerald-400">
                                            1 000 000 USDC
                                        </p>
                                        <p className="text-[11px] text-slate-400 mt-1">
                                            codzienna gra w wersji docelowej
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                                        <p className="text-[11px] text-slate-400 mb-1">
                                            Uczestnicy DEMO
                                        </p>
                                        <p className="text-sm font-semibold">132</p>
                                        <p className="text-[11px] text-slate-400 mt-1">
                                            punkty testowe, bez realnych środków
                                        </p>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 mb-3">
                                    <p className="text-[11px] text-slate-400 mb-1">
                                        Dzisiejsze losowanie (symulacja)
                                    </p>
                                    <div className="flex items-end justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-emerald-300">
                                                3 zwycięzców
                                            </p>
                                            <p className="text-[11px] text-slate-400">
                                                zapis wyników do historii cyklu
                                            </p>
                                        </div>
                                        <button className="text-[11px] rounded-full border border-slate-700 px-3 py-1 text-slate-200 hover:bg-slate-900 transition">
                                            Podgląd wyników
                                        </button>
                                    </div>
                                </div>

                                <p className="text-[10px] text-slate-500">
                                    Wszystkie dane na tej karcie są przykładową symulacją.
                                    Wersja DEMO nie wypłaca prawdziwych nagród.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* JAK TO DZIAŁA */}
                <section className="bg-slate-900/40 border-y border-slate-800">
                    <div className="mx-auto max-w-5xl px-4 py-12 md:py-16">
                        <h2 className="text-xl md:text-2xl font-semibold mb-6">
                            Jak działa POP33 DEMO
                        </h2>

                        <div className="grid gap-5 md:grid-cols-3 text-sm">
                            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                                <p className="text-xs text-slate-400 mb-1">Krok 1</p>
                                <h3 className="font-semibold mb-2">Dołącz przez Farcaster</h3>
                                <p className="text-slate-300 text-sm">
                                    Logujesz się swoim kontem Farcaster lub portfelem na
                                    testnecie. DEMO nie pobiera prawdziwych środków, symulujemy
                                    udział w losowaniach.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                                <p className="text-xs text-slate-400 mb-1">Krok 2</p>
                                <h3 className="font-semibold mb-2">Aktywny cykl POP33</h3>
                                <p className="text-slate-300 text-sm">
                                    System tworzy cykle losowań. Każdy cykl ma ograniczoną liczbę
                                    uczestników i z góry ustalony limit nagród. W DEMO pracujemy
                                    na punktach, nie na USDC.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                                <p className="text-xs text-slate-400 mb-1">Krok 3</p>
                                <h3 className="font-semibold mb-2">Codzienne losowanie</h3>
                                <p className="text-slate-300 text-sm">
                                    W każdym aktywnym cyklu odbywają się losowania zwycięzców.
                                    DEMO zapisuje wyniki, żeby każdy mógł przeanalizować
                                    statystyki, sprawiedliwość i przejrzystość systemu.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* DLACZEGO POP33 */}
                <section className="mx-auto max-w-5xl px-4 py-12 md:py-16">
                    <h2 className="text-xl md:text-2xl font-semibold mb-6">
                        Dlaczego POP33 jest inne
                    </h2>

                    <div className="grid gap-5 md:grid-cols-3 text-sm">
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                            <h3 className="font-semibold mb-2">Ludzie ponad zysk</h3>
                            <p className="text-slate-300 text-sm">
                                Klasyczne loterie często maksymalizują zysk organizatora.
                                POP33 ma odwrotne założenie – projekt powstaje po to, żeby
                                maksymalnie dużo wracało do społeczności.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                            <h3 className="font-semibold mb-2">Transparentna matematyka</h3>
                            <p className="text-slate-300 text-sm">
                                Logika losowań, limity cykli i sposób dystrybucji nagród są
                                oparte na prostych, jawnych zasadach. DEMO pozwala zweryfikować
                                działanie systemu w praktyce.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                            <h3 className="font-semibold mb-2">
                                Przygotowanie do realnego wdrożenia
                            </h3>
                            <p className="text-slate-300 text-sm">
                                Zanim POP33 trafi na mainnet i zacznie operować prawdziwymi
                                środkami, testujemy scenariusze: wielkość społeczności, limity
                                cykli, powtarzalność losowań oraz UX dla zwykłych użytkowników.
                            </p>
                        </div>
                    </div>
                </section>

                {/* CYKLE I LOSOWANIA */}
                <section className="bg-slate-900/40 border-y border-slate-800">
                    <div className="mx-auto max-w-5xl px-4 py-12 md:py-16">
                        <h2 className="text-xl md:text-2xl font-semibold mb-4">
                            Cykle, limity i losowania w wersji DEMO
                        </h2>
                        <p className="text-sm text-slate-300 mb-6 max-w-3xl">
                            POP33 działa w oparciu o cykle. Każdy cykl to ograniczona pula
                            miejsc, określony limit aktywnych losowań i z góry
                            zaprogramowane zasady podziału puli nagród. W DEMO używamy
                            punktów zamiast prawdziwych USDC.
                        </p>

                        <div className="grid gap-5 md:grid-cols-3 text-sm">
                            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                                <h3 className="font-semibold mb-2">Aktywne cykle</h3>
                                <p className="text-slate-300 text-sm">
                                    Testujemy limit liczby cykli, które mogą być aktywne jednocześnie.
                                    Panel użytkownika pokazuje ile cykli trwa, ile zamknięto
                                    i jakie były wyniki.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                                <h3 className="font-semibold mb-2">Symulowane pule nagród</h3>
                                <p className="text-slate-300 text-sm">
                                    Zamiast prawdziwych USDC używamy punktów DEMO. Możemy dzięki
                                    temu sprawdzać różne konfiguracje – liczbę zwycięzców,
                                    rozkład nagród i wpływ liczby uczestników.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                                <h3 className="font-semibold mb-2">Codzienne losowania</h3>
                                <p className="text-slate-300 text-sm">
                                    Celem POP33 jest model, w którym codziennie ktoś gra o
                                    1 000 000 USDC. W DEMO trenujemy algorytmy wyboru
                                    zwycięzców, zapis historii i wizualizację rezultatów,
                                    bez angażowania realnego kapitału.
                                </p>
                            </div>
                        </div>

                        <p className="mt-5 text-[11px] text-slate-400 max-w-3xl">
                            Uwaga: ta wersja nie jest ofertą inwestycyjną i nie umożliwia
                            wygrania prawdziwych środków. To wyłącznie środowisko testowe
                            dla mechaniki projektu.
                        </p>
                    </div>
                </section>
                {/* Sekcja o PMN / HODL */}
                <section className="mx-auto max-w-5xl px-4 py-12 md:py-16">
                    <h2 className="text-xl md:text-2xl font-semibold mb-4">
                        PMN, HODL i długoterminowa lojalność
                    </h2>
                    <p className="text-sm text-slate-300 mb-4 max-w-3xl">
                        W docelowym modelu POP33 planowane jest powiązanie aplikacji z tokenem PMN.
                        Część wpłat użytkowników miałaby być automatycznie dzielona w modelu
                        50 / 50 – jedna część na indywidualne DCA HODL w tokenie PMN,
                        druga część na specjalne konto HODL, które na smartkontrakcie
                        kumuluje środki do poziomu 1 000 000.
                    </p>
                    <p className="text-sm text-slate-300 max-w-3xl mb-2">
                        Po osiągnięciu tego poziomu planowane jest automatyczne wypłacenie zgromadzonej
                        kwoty zwycięzcy zgodnie z zasadami kontraktu. Jeżeli użytkownik wygra wcześniej,
                        jego konto HODL może zostać spalone jako element deflacyjny ekonomii tokena PMN
                        albo przekazane na cele charytatywne, marketingowe lub na dodatkowe losowanie.
                        Ostateczne zasady tego mechanizmu mają zostać wypracowane przez społeczność
                        i dostosowane do obowiązujących regulacji.
                    </p>
                    <p className="text-[11px] text-slate-500 max-w-3xl">
                        Ta sekcja opisuje kierunek rozwoju i nie stanowi oferty inwestycyjnej
                        ani gwarancji jakichkolwiek wyników finansowych.
                    </p>
                </section>


                {/* FAQ */}
                <section className="mx-auto max-w-5xl px-4 py-12 md:py-16">
                    <h2 className="text-xl md:text-2xl font-semibold mb-6">
                        Najczęściej zadawane pytania
                    </h2>

                    <div className="space-y-4 text-sm">
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                            <h3 className="font-semibold mb-2">
                                Czy mogę coś wygrać w wersji DEMO?
                            </h3>
                            <p className="text-slate-300 text-sm">
                                Nie. Wersja DEMO nie wypłaca prawdziwych nagród i nie przyjmuje
                                realnych depozytów. Służy testom, edukacji i dopracowaniu
                                logiki POP33.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                            <h3 className="font-semibold mb-2">
                                Czy muszę płacić, żeby testować aplikację?
                            </h3>
                            <p className="text-slate-300 text-sm">
                                Nie. DEMO korzysta z testnetu i symulowanych punktów. W
                                docelowym modelu planowana jest miesięczna subskrypcja, ale
                                nie obowiązuje ona w tej wersji.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                            <h3 className="font-semibold mb-2">
                                Po co w ogóle DEMO, skoro docelowo chodzi o prawdziwe nagrody?
                            </h3>
                            <p className="text-slate-300 text-sm">
                                Dzięki DEMO możemy sprawdzić, jak zachowuje się system przy
                                rosnącej liczbie użytkowników, jak wyglądają statystyki
                                wygranych, czy limity cykli są dobrze dobrane oraz czy
                                interfejs jest zrozumiały dla zwykłych użytkowników.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                            <h3 className="font-semibold mb-2">
                                Czy POP33 to porada inwestycyjna albo obietnica zysku?
                            </h3>
                            <p className="text-slate-300 text-sm mb-2">
                                Nie. POP33 jest eksperymentem społecznym i koncepcją aplikacji
                                finansowej opartej na blockchainie. Zanim powstanie realny
                                produkt, konieczne będzie dopracowanie aspektów prawnych,
                                regulacyjnych i technicznych. Wersja DEMO nie jest ofertą
                                inwestycyjną.
                            </p>
                            <p className="text-slate-300 text-sm">
                                Jednym z elementów projektowanej tokenomii jest powiązanie
                                POP33 z tokenem PMN poprzez mechanizm automatycznego zakupu.
                                Idea jest taka, żeby część kwoty z długoterminowego udziału
                                użytkownika była regularnie dzielona w modelu 50 / 50 na:
                                DCA HODL użytkownika w tokenie PMN oraz specjalne konto HODL
                                na smartkontrakcie, które docelowo ma kumulować środki do
                                poziomu 1 000 000. Po osiągnięciu tego poziomu planowane jest
                                automatyczne wypłacenie zgromadzonej kwoty zwycięzcy zgodnie
                                z zasadami kontraktu. Jeżeli użytkownik wygra wcześniej, jego
                                konto HODL może zostać spalone jako element deflacyjny
                                ekonomii tokena PMN albo przekazane na cele charytatywne,
                                marketingowe lub na dodatkowe losowanie. Ostateczne zasady
                                będą wypracowane przez społeczność i dostosowane do
                                obowiązujących regulacji.
                            </p>
                        </div>
                    </div>
                </section>
            </main>

            {/* FOOTER */}
            <footer className="border-t border-slate-800">
                <div className="mx-auto max-w-5xl px-4 py-6 text-[11px] text-slate-400 space-y-2">
                    <p>
                        POP33 – ludzie ponad zysk, najpierw testujemy, potem wdrażamy.
                    </p>
                    <p>
                        POP33 DEMO to środowisko testowe na blockchainie. Strona ma
                        charakter informacyjny i edukacyjny, nie stanowi oferty
                        inwestycyjnej, rekomendacji ani zachęty do zakupu jakichkolwiek
                        instrumentów finansowych.
                    </p>
                    <p>
                        Token PMN funkcjonuje na wolnym rynku. Każda decyzja o jego
                        samodzielnym zakupie, sprzedaży lub przetrzymywaniu należy
                        wyłącznie do użytkownika i wiąże się z jego własną
                        odpowiedzialnością oraz ryzykiem. POP33 DEMO nie zachęca do
                        nabywania tokena PMN ani nie gwarantuje żadnych rezultatów
                        finansowych.
                    </p>
                </div>
            </footer>
        </div>
    );
}
