export const BODY_TYPES = [
  { id: 'none', label: 'None' },
  { id: 'form-data', label: 'Form Data' },
  { id: 'urlencoded', label: 'URL Encoded' },
  { id: 'json', label: 'JSON' },
  { id: 'raw', label: 'Raw' },
] as const

interface Props {
  value: string
  onChange: (type: string) => void
  children?: React.ReactNode
}

export function BodyTypeSelector({ value, onChange, children }: Props) {
  return (
    <div className="flex items-center gap-1">
      {BODY_TYPES.map((bt) => (
        <button
          key={bt.id}
          type="button"
          className={`px-2.5 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-colors ${
            value === bt.id
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-overlay/[0.04]'
          }`}
          onClick={() => onChange(bt.id)}
        >
          {bt.label}
        </button>
      ))}
      {children}
    </div>
  )
}
