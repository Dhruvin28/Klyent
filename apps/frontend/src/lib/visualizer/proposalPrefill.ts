import { SQFT_PER_SQM, formatQuantity, type OptionEstimate } from './estimate'

export interface ProposalPrefill {
  source: { projectName: string; optionName: string; clientId: string | null }
  materialSection: { title: string; rateLabel: string; items: { srNo: number; description: string; rate: string }[] }
  costBreakupItems: { item: string; description: string; amount: number }[]
}

const money = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/**
 * Turns an option's quantity estimate into a cost-breakup proposal draft: one material
 * line per material (where, what, how much) and one cost line per priced material.
 */
export function buildProposalPrefill(projectName: string, optionName: string, clientId: string | null, est: OptionEstimate): ProposalPrefill {
  const items = est.lines.map((l, i) => {
    const m = l.material
    const ref = [m.brand, m.code].filter(Boolean).join(' ')
    const what = `${m.name}${ref ? ` (${ref})` : ''}`
    return {
      srNo: i + 1,
      description: `${l.surfaces.join(', ')} — ${what}: ${(l.areaSqm * SQFT_PER_SQM).toLocaleString('en-IN', { maximumFractionDigits: 1 })} sq ft, ${formatQuantity(l)}`.slice(0, 500),
      rate: l.rate != null ? `${money(l.rate)} / ${l.unit === 'sqft' ? 'sq ft' : l.unit === 'sqm' ? 'm²' : l.unit}`.slice(0, 100) : '',
    }
  })
  return {
    source: { projectName, optionName, clientId },
    materialSection: { title: `Materials — ${optionName}`.slice(0, 100), rateLabel: 'Rate', items },
    costBreakupItems: est.lines
      .filter((l) => l.cost != null)
      .map((l) => ({
        item: l.material.name.slice(0, 200),
        description: `${l.surfaces.join(', ')}: ${formatQuantity(l)} (${l.basis})`.slice(0, 1000),
        amount: l.cost!,
      })),
  }
}
