"use client"

/**
 * Champ de mot de passe avec bouton d'affichage.
 *
 * Masquer la saisie protege d'un regard par-dessus l'epaule, mais fait aussi
 * saisir des fautes de frappe invisibles — d'ou le bouton. Il est hors du flux
 * de tabulation : au clavier, on passe du champ au suivant sans buter dessus,
 * et la souris reste le moyen naturel de l'actionner.
 */

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { useTranslations } from "next-intl"

import { Input, type InputProps } from "@/components/ui/input"

export type PasswordInputProps = Omit<InputProps, "type" | "trailing">

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ ...props }, ref) => {
    const t = useTranslations("common.form")
    const [visible, setVisible] = React.useState(false)

    return (
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        trailing={
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? t("hidePassword") : t("showPassword")}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-slate-100 hover:text-foreground"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
        {...props}
      />
    )
  }
)
PasswordInput.displayName = "PasswordInput"

export { PasswordInput }
