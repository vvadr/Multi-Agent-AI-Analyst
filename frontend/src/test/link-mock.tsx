/**
 * Stand-in for `next/link`, which needs the App Router context that component
 * tests do not provide. Renders the plain anchor the real component produces,
 * so link roles and hrefs stay assertable.
 */

export default function Link({
  href,
  children,
  ...rest
}: {
  href: string;
  children: React.ReactNode;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
