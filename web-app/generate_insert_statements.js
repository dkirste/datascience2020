const loremIpsum = require("lorem-ipsum")

const numberOfProducts = 7

const sqls = Array.from(Array(numberOfProducts).keys())
	.map(productId => {
		const heading = loremIpsum.loremIpsum({ count: 1, units: "sentence" }).replace(/[\r\n]+/g, "");
		const description = loremIpsum.loremIpsum({ count: 5, units: "paragraphs" }).replace(/[\r\n]+/g, "\\n");

		return `INSERT INTO products (product, description, heading) VALUES ('p-${productId}', '${description}', '${heading}');`
	})
	.join("\n")

console.log(sqls)
