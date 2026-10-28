// PDFs: Rechnung (auch Storno), Lieferschein, Kommission, Quittung. Nur Standardschriften, keine externen Zugriffe.
import pdfmake from 'pdfmake';
import type { Einstellungen, Filiale } from '../../shared/types.ts';
import {
  anschriftZeilen,
  datumDeutsch,
  etageText,
  euro,
  LIEFERART_NAMEN,
  positionBrutto,
  RESTZAHLUNG_NAMEN,
  type Vorgang,
  ZAHLMITTEL_NAMEN,
} from '../../shared/verkauf.ts';

export type PdfArt = 'rechnung' | 'lieferschein' | 'kommission' | 'quittung';
export const PDF_ARTEN: PdfArt[] = ['rechnung', 'lieferschein', 'kommission', 'quittung'];

export interface DruckDaten {
  vorgang: Vorgang;
  einstellungen: Einstellungen;
  filiale: Filiale;
  logo: { daten: Buffer; mime: string } | null;
  zahlungId?: number;
}

type Inhalt = Record<string, unknown> | string | Inhalt[];

const SCHRIFT = { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' };
pdfmake.setFonts({ Helvetica: SCHRIFT });
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((pfad: string) => Object.values(SCHRIFT).includes(pfad));

const GRAU = '#555555';
const LINIE = { hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3), vLineWidth: () => 0, hLineColor: () => '#999999', paddingTop: () => 3, paddingBottom: () => 3 };

function logoInhalt(logo: DruckDaten['logo']): Inhalt | null {
  if (!logo) return null;
  if (logo.mime === 'image/svg+xml') return { svg: logo.daten.toString('utf8'), fit: [170, 60] };
  if (logo.mime === 'image/png' || logo.mime === 'image/jpeg') return { image: `data:${logo.mime};base64,${logo.daten.toString('base64')}`, fit: [170, 60] };
  return null; // WebP kann pdfkit nicht einbetten
}

function kopf(d: DruckDaten, titel: string, infos: [string, string][], empfaenger: string[]): Inhalt[] {
  const e = d.einstellungen;
  const f = d.filiale;
  const absender = [e.firmenname, f.strasse || e.strasse, `${f.plz || e.plz} ${f.ort || e.ort}`.trim()].filter(Boolean).join(' · ');
  const firma = [
    { text: e.firmenname, bold: true },
    `Filiale ${f.name}`,
    f.strasse || e.strasse,
    `${f.plz || e.plz} ${f.ort || e.ort}`.trim(),
    (f.telefon || e.telefon) && `Tel. ${f.telefon || e.telefon}`,
    f.fax && `Fax ${f.fax}`,
    f.email || e.email,
    e.web,
  ].filter(Boolean);
  return [
    { columns: [logoInhalt(d.logo) ?? { text: e.firmenname, fontSize: 16, bold: true }, { stack: firma, alignment: 'right', fontSize: 8.5, color: GRAU }] },
    {
      margin: [0, 28, 0, 0],
      columns: [
        { width: '*', stack: [{ text: absender, fontSize: 7, color: GRAU, margin: [0, 0, 0, 4] }, ...empfaenger] },
        {
          width: 200,
          table: { widths: [90, '*'], body: infos.map(([k, w]) => [{ text: k, color: GRAU }, { text: w, bold: k.startsWith('Rechnung') || k.startsWith('Storno') }]) },
          layout: 'noBorders',
          fontSize: 9,
        },
      ],
    },
    { text: titel, fontSize: 15, bold: true, margin: [0, 24, 0, 10] },
  ];
}

function fuss(e: Einstellungen) {
  const zeile1 = [e.firmenname, e.steuernummer && `Steuernr. ${e.steuernummer}`, e.ustId && `USt-IdNr. ${e.ustId}`].filter(Boolean).join(' · ');
  const zeile2 = [e.bankName, e.iban && `IBAN ${e.iban}`, e.bic && `BIC ${e.bic}`].filter(Boolean).join(' · ');
  return (seite: number, seiten: number) => ({
    margin: [50, 10, 50, 0],
    fontSize: 7.5,
    color: GRAU,
    columns: [{ stack: [zeile1, zeile2] }, { text: `Seite ${seite} von ${seiten}`, alignment: 'right', width: 70 }],
  });
}

const empfaengerVon = (v: Vorgang) => anschriftZeilen(v.rechnungsanschrift ?? v.kunde);

function lieferAngaben(v: Vorgang): Inhalt[] {
  const l = v.lieferung;
  const zeilen: [string, string][] = [['Lieferart', LIEFERART_NAMEN[l.art]]];
  if (l.von) zeilen.push([l.art === 'lieferung' ? 'Ausliefern von' : 'Abholung aus', l.von]);
  if (l.datum) zeilen.push([l.art === 'lieferung' ? 'Liefertermin' : 'Abholtermin', `${datumDeutsch(l.datum)}${l.zeitfenster ? `, ${l.zeitfenster}` : ''}`]);
  if (l.art === 'lieferung') {
    if (etageText(l)) zeilen.push(['Etage', etageText(l)]);
    zeilen.push(['Montage', l.montage ? `ja, vorauss. Dauer ${l.montageMinuten} min` : 'Keine Montage']);
    if (l.wagen) zeilen.push(['Wagen', l.wagen]);
  }
  if (l.hinweis) zeilen.push(['Hinweis', l.hinweis]);
  return [{ table: { widths: [90, '*'], body: zeilen.map(([k, w]) => [{ text: k, color: GRAU }, w]) }, layout: 'noBorders', margin: [0, 10, 0, 0] }];
}

function hinweisTexte(d: DruckDaten): Inhalt[] {
  const genutzt = new Set(d.vorgang.positionen.flatMap((p) => p.kennzeichen));
  return d.einstellungen.hinweise
    .filter((h) => genutzt.has(h.zeichen))
    .map((h) => ({ text: `(${h.zeichen}) ${h.text}`, fontSize: 8, margin: [0, 6, 0, 0] }));
}

const bezeichnung = (p: Vorgang['positionen'][number], mitLager: boolean): Inhalt => ({
  stack: [
    `${p.text}${p.kennzeichen.length ? ` (${p.kennzeichen.join(') (')})` : ''}`,
    ...(mitLager && p.lagerort ? [{ text: `Lagerort: ${p.lagerort}`, fontSize: 8, color: GRAU }] : []),
  ],
});

const menge = (m: number) => m.toLocaleString('de-DE', { maximumFractionDigits: 3 });

function rechnung(d: DruckDaten): Inhalt[] {
  const v = d.vorgang;
  const s = v.summen;
  const storno = v.art === 'storno';
  const vz = storno ? -1 : 1;
  const nummer = v.nummer ?? 'Entwurf';
  const infos: [string, string][] = [
    [storno ? 'Storno Nr.' : 'Rechnung Nr.', nummer],
    ...(storno && v.bezug ? ([['zu Rechnung', v.bezug.nummer]] as [string, string][]) : []),
    ['Datum', datumDeutsch(v.datum)],
    ['Leistungsdatum', datumDeutsch(v.lieferung.datum ?? v.datum)],
    ['Filiale', d.filiale.kuerzel],
    ['Sachbearbeiter', v.sachbearbeiter],
  ];
  if (v.kunde.telefon) infos.push(['Telefon', v.kunde.telefon]);

  const kopfzeile = ['Pos.', 'Menge', 'Bezeichnung', { text: 'Einzelpreis', alignment: 'right' }, { text: 'USt', alignment: 'right' }, { text: 'Gesamt', alignment: 'right' }].map((t) =>
    typeof t === 'string' ? { text: t, bold: true } : { ...t, bold: true },
  );
  const zeilen = v.positionen.map((p, i) => [
    String(i + 1),
    menge(p.menge),
    bezeichnung(p, false),
    { text: euro(p.preisCent * vz), alignment: 'right' },
    { text: `${p.ust} %`, alignment: 'right' },
    { text: euro(positionBrutto(p) * vz), alignment: 'right' },
  ]);

  const summe: [string, number, boolean?][] = [];
  if (s.rabattCent || s.lieferungCent || s.montageCent) summe.push(['Summe Artikel', s.artikelCent]);
  if (s.rabattCent && v.rabatt) summe.push([`abzüglich ${v.rabatt.name} (${v.rabatt.prozent} %)`, -s.rabattCent]);
  if (s.lieferungCent) summe.push(['Lieferkosten', s.lieferungCent]);
  if (s.montageCent) summe.push(['Montage', s.montageCent]);
  summe.push([storno ? 'Erstattungsbetrag brutto' : s.lieferungCent || s.montageCent ? 'Gesamt inkl. Lieferung und Montage' : 'Rechnungsbetrag brutto', s.bruttoCent, true]);
  const steuer = s.steuer.map((z) => [`darin enthalten ${z.satz} % USt auf ${euro(z.nettoCent)} netto`, z.steuerCent] as [string, number]);

  const zahlung: Inhalt[] = [];
  if (!storno && v.status === 'festgeschrieben') {
    const anzahlung = v.zahlungen.filter((z) => z.zweck === 'anzahlung').reduce((a, z) => a + z.betragCent, 0);
    const rest = s.bruttoCent - anzahlung;
    if (anzahlung && rest <= 0) zahlung.push({ text: `Betrag dankend erhalten (${ZAHLMITTEL_NAMEN[v.zahlung.anzahlungMittel]}).`, bold: true });
    else {
      if (anzahlung) zahlung.push({ text: `Anzahlungsbetrag ${euro(anzahlung)} dankend erhalten (${ZAHLMITTEL_NAMEN[v.zahlung.anzahlungMittel]}).` });
      zahlung.push({ text: `Offener Restbetrag: ${euro(rest)} – ${RESTZAHLUNG_NAMEN[v.zahlung.rest].toLowerCase()}.`, bold: true });
      if (v.zahlung.rest === 'ueberweisung') {
        zahlung.push(`Bitte überweisen Sie den Betrag auf das unten angegebene Konto. Zahlbar sofort ohne Abzug. Bitte geben Sie die Rechnungsnummer ${nummer} an.`);
      }
    }
  }
  if (storno) {
    const erstattet = v.zahlungen.reduce((a, z) => a + z.betragCent, 0);
    if (v.stornoGrund) zahlung.push(`Grund: ${v.stornoGrund}`);
    if (erstattet) zahlung.push({ text: `Erstattet: ${euro(-erstattet)} (${ZAHLMITTEL_NAMEN[v.zahlungen[0]!.mittel]}).`, bold: true });
  }

  return [
    ...kopf(d, storno ? 'Stornorechnung' : 'Rechnung', infos, empfaengerVon(v)),
    v.rechnungsanschrift ? { text: ['Lieferanschrift: ', anschriftZeilen(v.kunde).join(', ')], fontSize: 9, margin: [0, 0, 0, 8] } : '',
    storno && v.bezug ? { text: `Wir stornieren die Rechnung ${v.bezug.nummer} vollständig.`, margin: [0, 0, 0, 6] } : '',
    {
      text: storno ? 'Für die nachfolgend aufgeführten Gegenstände erstatten wir Ihnen:' : 'Für die nachfolgend aufgeführten Gegenstände berechnen wir Ihnen:',
      margin: [0, 0, 0, 6],
    },
    { table: { headerRows: 1, widths: [24, 36, '*', 62, 32, 66], body: [kopfzeile, ...zeilen] }, layout: LINIE, fontSize: 9 },
    {
      margin: [0, 8, 0, 0],
      table: {
        widths: ['*', 90],
        body: [
          ...summe.map(([k, c, fett]) => [{ text: k, alignment: 'right', bold: fett }, { text: euro(c * vz), alignment: 'right', bold: fett }]),
          ...steuer.map(([k, c]) => [{ text: k, alignment: 'right', fontSize: 8, color: GRAU }, { text: euro(c * vz), alignment: 'right', fontSize: 8, color: GRAU }]),
        ],
      },
      layout: 'noBorders',
      fontSize: 9.5,
    },
    { stack: zahlung, margin: [0, 12, 0, 0], fontSize: 9.5 },
    ...lieferAngaben(v),
    v.bemerkung ? { text: v.bemerkung, margin: [0, 8, 0, 0], fontSize: 9 } : '',
    ...hinweisTexte(d),
    { text: d.einstellungen.fusstext, margin: [0, 16, 0, 0], fontSize: 9 },
    { text: 'Bei Rückfragen bitte immer die Rechnungsnummer angeben.', fontSize: 8, color: GRAU, margin: [0, 4, 0, 0] },
  ];
}

function lieferschein(d: DruckDaten): Inhalt[] {
  const v = d.vorgang;
  const infos: [string, string][] = [
    ['Rechnung Nr.', v.nummer ?? 'Entwurf'],
    ['Datum', datumDeutsch(v.datum)],
    ['Filiale', d.filiale.kuerzel],
  ];
  if (v.kunde.telefon) infos.push(['Telefon', v.kunde.telefon]);
  const kassieren = v.offenCent > 0 && v.zahlung.rest !== 'ueberweisung' ? v.offenCent : 0;
  return [
    ...kopf(d, 'Lieferschein', infos, anschriftZeilen(v.kunde)),
    { text: 'Folgende Gegenstände stehen zur Lieferung bereit:', margin: [0, 0, 0, 6] },
    {
      table: {
        headerRows: 1,
        widths: [24, 40, '*'],
        body: [[{ text: 'Pos.', bold: true }, { text: 'Menge', bold: true }, { text: 'Bezeichnung', bold: true }], ...v.positionen.map((p, i) => [String(i + 1), menge(p.menge), bezeichnung(p, true)])],
      },
      layout: LINIE,
      fontSize: 10,
    },
    ...lieferAngaben(v),
    kassieren ? { text: `Bei ${v.lieferung.art === 'lieferung' ? 'Lieferung' : 'Abholung'} zu kassieren: ${euro(kassieren)}`, bold: true, fontSize: 12, margin: [0, 12, 0, 0] } : '',
    ...hinweisTexte(d),
    { text: 'Die Ware habe/n ich/wir einwandfrei und vollständig erhalten.', margin: [0, 40, 0, 30] },
    { columns: [{ text: '_______________________________\nOrt, Datum', fontSize: 9 }, { text: '_______________________________\nUnterschrift', fontSize: 9 }] },
  ];
}

function kommission(d: DruckDaten): Inhalt[] {
  const v = d.vorgang;
  const infos: [string, string][] = [
    ['Rechnung Nr.', v.nummer ?? 'Entwurf'],
    ['Datum', datumDeutsch(v.datum)],
    ['Filiale', d.filiale.kuerzel],
    ['Sachbearbeiter', v.sachbearbeiter],
  ];
  return [
    ...kopf(d, 'Kommission', infos, anschriftZeilen(v.kunde)),
    {
      table: {
        headerRows: 1,
        widths: [18, 24, 40, '*', 110],
        body: [
          ['', 'Pos.', 'Menge', 'Bezeichnung', 'Lagerort'].map((t) => ({ text: t, bold: true })),
          ...v.positionen.map((p, i) => ['[  ]', String(i + 1), menge(p.menge), bezeichnung(p, false), p.lagerort || v.lieferung.von || '–']),
        ],
      },
      layout: LINIE,
      fontSize: 10,
    },
    ...lieferAngaben(v),
    v.bemerkung ? { text: v.bemerkung, margin: [0, 8, 0, 0] } : '',
    { text: 'Kommissioniert von: _______________________   Datum: ____________', margin: [0, 40, 0, 0], fontSize: 9 },
  ];
}

function quittung(d: DruckDaten): Inhalt[] {
  const v = d.vorgang;
  const z = v.zahlungen.find((x) => x.id === d.zahlungId);
  if (!z) throw new Error('Zahlung nicht gefunden');
  const bisher = v.zahlungen.filter((x) => x.id <= z.id).reduce((a, x) => a + x.betragCent, 0);
  const rest = v.summen.bruttoCent - bisher;
  const zeit = new Date(z.zeit);
  return [
    ...kopf(d, 'Quittung', [['zu Rechnung', v.nummer ?? ''], ['Datum', zeit.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })], ['Filiale', d.filiale.kuerzel]], empfaengerVon(v)),
    {
      table: {
        widths: [150, '*'],
        body: [
          ['Rechnungsbetrag brutto', euro(v.summen.bruttoCent)],
          [{ text: 'Heute erhalten', bold: true }, { text: `${euro(z.betragCent)} (${ZAHLMITTEL_NAMEN[z.mittel]})`, bold: true }],
          ...(z.kassenBon ? [['Kassenbon', z.kassenBon]] : []),
          ['Bisher insgesamt bezahlt', euro(bisher)],
          ['Offener Restbetrag', euro(rest)],
        ],
      },
      layout: 'noBorders',
    },
    { text: 'Betrag dankend erhalten.', bold: true, margin: [0, 16, 0, 0] },
    { text: d.einstellungen.fusstext, margin: [0, 16, 0, 0], fontSize: 9 },
  ];
}

export async function pdfErstellen(art: PdfArt, d: DruckDaten): Promise<Buffer> {
  const inhalt = { rechnung, lieferschein, kommission, quittung }[art](d);
  const entwurf = d.vorgang.status === 'entwurf';
  const doc = pdfmake.createPdf({
    pageSize: 'A4',
    pageMargins: [50, 40, 50, 60],
    info: { title: `${art} ${d.vorgang.nummer ?? 'Entwurf'}`, author: d.einstellungen.firmenname, producer: 'Cash & Raus' },
    watermark: entwurf ? { text: 'ENTWURF', opacity: 0.08, bold: true } : undefined,
    defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.15 },
    footer: fuss(d.einstellungen),
    content: inhalt,
  });
  return doc.getBuffer();
}
