import { TransactionalPage } from "../transactional/TransactionalPage";
import { Button } from "../ui/button";

/**
 * HXBot: the page for an address that does not exist. It shows only HXBot and links to the
 * web app and the download page. HXBot's site header, footer and page suggestions are not shown.
 */
export function NotFoundPage() {
  return (
    <TransactionalPage titleId="not-found-title">
      <h1 id="not-found-title">页面不存在 · Page not found</h1>
      <p class="join-card-copy">
        这个地址没有内容：链接可能已失效，或服务器暂时连接不上。The page does not exist: the link may be out of date, or
        the server cannot be reached right now.
      </p>
      <div class="join-card-actions">
        <Button href="/app" variant="primary" size="lg" icon="arrow-right">
          打开网页版 · Open the web app
        </Button>
        <Button href="/" variant="secondary" size="lg" icon="open">
          下载页 · Download page
        </Button>
      </div>
    </TransactionalPage>
  );
}
