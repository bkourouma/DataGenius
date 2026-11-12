"use client"

import * as React from "react"
import { Check, ChevronDown, X } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { trierParLibelle } from "@/lib/tri/libelles"

export interface MultiSelectOption {
  label: string
  value: string
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  className?: string
  maxDisplay?: number
  /**
   * Affiche les options par libelle croissant (A -> Z, langue de l'interface).
   * `false` garde l'ordre de `options`, quand il porte un sens (mois, etapes...).
   */
  trierOptions?: boolean
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  className,
  maxDisplay = 3,
  trierOptions = true,
}: MultiSelectProps) {
  const t = useTranslations("common")
  const locale = useLocale()
  const optionsAffichees = React.useMemo(
    () => (trierOptions ? trierParLibelle(options, (option) => option.label, locale) : options),
    [options, trierOptions, locale]
  )
  const [open, setOpen] = React.useState(false)

  const handleSelect = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const handleRemove = (value: string) => {
    onChange(selected.filter((item) => item !== value))
  }

  const handleClearAll = () => {
    onChange([])
  }

  const selectedOptions = optionsAffichees.filter((option) =>
    selected.includes(option.value)
  )

  const displayText = () => {
    if (selected.length === 0) {
      return placeholder ?? t("form.selectOption")
    }

    if (selected.length <= maxDisplay) {
      return selectedOptions.map((option) => option.label).join(", ")
    }

    return `${selectedOptions.slice(0, maxDisplay).map((option) => option.label).join(", ")} ${t("ui.moreItems", { count: selected.length - maxDisplay })}`
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between text-left font-normal",
            !selected.length && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{displayText()}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <div className="max-h-60 overflow-auto">
          {selected.length > 0 && (
            <div className="flex items-center justify-between p-2 border-b">
              <span className="text-sm text-muted-foreground">
                {t("table.selected", { count: selected.length })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="h-6 px-2 text-xs"
              >
                {t("ui.clearAll")}
              </Button>
            </div>
          )}
          <div className="p-1">
            {optionsAffichees.map((option) => (
              <div
                key={option.value}
                className="flex items-center space-x-2 p-2 hover:bg-accent hover:text-accent-foreground rounded-sm cursor-pointer"
                onClick={() => handleSelect(option.value)}
              >
                <Checkbox
                  checked={selected.includes(option.value)}
                  onChange={() => handleSelect(option.value)}
                />
                <span className="text-sm">{option.label}</span>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
      
      {/* Selected items as badges */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selectedOptions.map((option) => (
            <Badge
              key={option.value}
              variant="secondary"
              className="text-xs"
            >
              {option.label}
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 h-3 w-3 p-0 hover:bg-transparent"
                onClick={() => handleRemove(option.value)}
              >
                <X className="h-2 w-2" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </Popover>
  )
}
