import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getSharedBoard } from '../lib/boards';
import { Wordmark } from '../brand/Wordmark';

interface SharedItem {
  image_url: string;
  thumb_url: string;
  width: number | null;
  height: number | null;
  title: string | null;
  creator: string | null;
  date: string | null;
  source: string | null;
  license: string | null;
  source_url: string | null;
}

interface SharedData {
  name: string;
  item_count: number;
  items: SharedItem[];
}

export function SharedBoard() {
  const { slug } = useParams();
  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      setLoading(true);
      const result = await getSharedBoard(slug);
      if (result) setData(result);
      else setError(true);
      setLoading(false);
    })();
  }, [slug]);

  useEffect(() => {
    document.title = data ? `${data.name} \u00b7 Lathe` : 'Lathe';
  }, [data]);

  if (loading) return <div className="shared-board shared-board--loading"><p>Loading board&hellip;</p></div>;
  if (error || !data) return (
    <div className="shared-board shared-board--error">
      <h1>Board not found</h1>
      <p>This link may have expired or the board is no longer shared.</p>
      <Link to="/">Go to Lathe</Link>
    </div>
  );

  return (
    <div className="shared-board">
      <header className="shared-board__header">
        <div>
          <h1 className="shared-board__name">{data.name}</h1>
          <p className="shared-board__count">{data.item_count} image{data.item_count !== 1 ? 's' : ''}</p>
        </div>
      </header>
      <div className="shared-board__grid">
        {data.items.map((item, i) => (
          <figure key={i} className="shared-board__item">
            <img src={item.thumb_url || item.image_url} alt={item.title || ''} loading="lazy" />
            {item.title && <figcaption>
              <span className="shared-board__title">{item.title}</span>
              {item.creator && <span className="shared-board__creator">{item.creator}</span>}
              {item.source_url && <a href={item.source_url} target="_blank" rel="noopener" className="shared-board__source">{item.source}</a>}
            </figcaption>}
          </figure>
        ))}
      </div>
      <footer className="shared-board__footer">
        <Link to="/" className="shared-board__lathe"><Wordmark /> <span>Made with Lathe</span></Link>
      </footer>
    </div>
  );
}
