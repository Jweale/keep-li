/* eslint-disable react/prop-types */
import * as React from "react";

import { cn } from "@/lib/utils";

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("text-sm font-medium text-text/80", className)}
      {...props}
    />
  )
);
Label.displayName = "Label";

export { Label };
