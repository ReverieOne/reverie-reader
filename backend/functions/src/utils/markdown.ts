export interface TidyOptions {
    removeImages?: boolean;
    removeLinks?: boolean;
}

export function tidyMarkdown(markdown: string, options: TidyOptions = {}): string {
    let normalizedMarkdown = markdown;

    if (options.removeImages) {
        // Simpler regex for images - matches both inline and reference images
        normalizedMarkdown = normalizedMarkdown.replace(/!\[[^\]]*\](?:\([^)]+\)|\[[^\]]*\])/g, '');
    }

    if (options.removeLinks) {
        // Simpler regex for links - captures the text inside brackets
        normalizedMarkdown = normalizedMarkdown.replace(/\[([^\]]+)\](?:\([^)]+\)|\[[^\]]*\])/g, '$1');
    }

    // Handle complex broken links with text and optional images
    normalizedMarkdown = normalizedMarkdown.replace(/\[\s*([^\]\n]+?)\s*\]\s*\(\s*([^)]+)\s*\)/g, (match, text, url) => {
        text = text.replace(/\s+/g, ' ').trim();
        url = url.replace(/\s+/g, '').trim();
        return options.removeLinks ? text : `[${text}](${url})`;
    });

    // Handle complex image-link combinations
    normalizedMarkdown = normalizedMarkdown.replace(/\[\s*([^\]\n!]*?)\s*\n*(?:!\[([^\]]*)\]\((.*?)\))?\s*\n*\]\s*\(\s*([^)]+)\s*\)/g,
        (match, text, alt, imgUrl, linkUrl) => {
            text = text.replace(/\s+/g, ' ').trim();
            if (options.removeImages && options.removeLinks) {
                return text;
            } else if (options.removeImages) {
                return `[${text}](${linkUrl})`;
            } else if (options.removeLinks) {
                return text + (imgUrl ? ` ![${alt}](${imgUrl})` : '');
            }
            alt = alt ? alt.replace(/\s+/g, ' ').trim() : '';
            imgUrl = imgUrl ? imgUrl.replace(/\s+/g, '').trim() : '';
            linkUrl = linkUrl.replace(/\s+/g, '').trim();
            return imgUrl ? `[${text} ![${alt}](${imgUrl})](${linkUrl})` : `[${text}](${linkUrl})`;
    });

    normalizedMarkdown = normalizedMarkdown.replace(/\n{3,}/g, '\n\n');
    normalizedMarkdown = normalizedMarkdown.replace(/^[ \t]+/gm, '');

    return normalizedMarkdown.trim();
}
