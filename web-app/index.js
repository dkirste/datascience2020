const os = require('os')
const dns = require('dns').promises
const { program: optionparser } = require('commander')
const { Kafka } = require('kafkajs')
const mysqlx = require('@mysql/xdevapi');
const MemcachePlus = require('memcache-plus');
const express = require('express')

const app = express()
const cacheTimeSecs = 15
const numberOfProducts = 7

// -------------------------------------------------------
// Command-line options
// -------------------------------------------------------

let options = optionparser
	.storeOptionsAsProperties(true)
	// Web server
	.option('--port <port>', "Web server port", 3000)
	// Kafka options
	.option('--kafka-broker <host:port>', "Kafka bootstrap host:port", "my-cluster-kafka-bootstrap:9092")
	.option('--kafka-topic-tracking <topic>', "Kafka topic to tracking data send to", "tracking-data")
	.option('--kafka-topic-cart <topic>', "Kafka topic to send cart data to", "cart-data")
	.option('--kafka-client-id < id > ', "Kafka client ID", "tracker-" + Math.floor(Math.random() * 100000))
	// Memcached options
	.option('--memcached-hostname <hostname>', 'Memcached hostname (may resolve to multiple IPs)', 'my-memcached-service')
	.option('--memcached-port <port>', 'Memcached port', 11211)
	.option('--memcached-update-interval <ms>', 'Interval to query DNS for memcached IPs', 5000)
	// Database options
	.option('--mysql-host <host>', 'MySQL host', 'my-app-mysql-service')
	.option('--mysql-port <port>', 'MySQL port', 33060)
	.option('--mysql-schema <db>', 'MySQL Schema/database', 'popular')
	.option('--mysql-username <username>', 'MySQL username', 'root')
	.option('--mysql-password <password>', 'MySQL password', 'mysecretpw')
	// Misc
	.addHelpCommand()
	.parse()
	.opts()

// -------------------------------------------------------
// Database Configuration
// -------------------------------------------------------

const dbConfig = {
	host: options.mysqlHost,
	port: options.mysqlPort,
	user: options.mysqlUsername,
	password: options.mysqlPassword,
	schema: options.mysqlSchema
};

async function executeQuery(query, data) {
	let session = await mysqlx.getSession(dbConfig);
	return await session.sql(query, data).bind(data).execute()
}

// -------------------------------------------------------
// Memache Configuration
// -------------------------------------------------------

//Connect to the memcached instances
let memcached = null
let memcachedServers = []

async function getMemcachedServersFromDns() {
	try {
		// Query all IP addresses for this hostname
		let queryResult = await dns.lookup(options.memcachedHostname, { all: true })

		// Create IP:Port mappings
		let servers = queryResult.map(el => el.address + ":" + options.memcachedPort)

		// Check if the list of servers has changed
		// and only create a new object if the server list has changed
		if (memcachedServers.sort().toString() !== servers.sort().toString()) {
			console.log("Updated memcached server list to ", servers)
			memcachedServers = servers

			//Disconnect an existing client
			if (memcached)
				await memcached.disconnect()

			memcached = new MemcachePlus(memcachedServers);
		}
	} catch (e) {
		console.log("Unable to get memcache servers", e)
	}
}

//Initially try to connect to the memcached servers, then each 5s update the list
getMemcachedServersFromDns()
setInterval(() => getMemcachedServersFromDns(), options.memcachedUpdateInterval)

//Get data from cache if a cache exists yet
async function getFromCache(key) {
	if (!memcached) {
		console.log(`No memcached instance available, memcachedServers = ${memcachedServers}`)
		return null;
	}
	return await memcached.get(key);
}

// -------------------------------------------------------
// Kafka Configuration
// -------------------------------------------------------

// Kafka connection
const kafka = new Kafka({
	clientId: options.kafkaClientId,
	brokers: [options.kafkaBroker],
	retry: {
		retries: 0
	}
})

const producer = kafka.producer()
// End

// Send tracking message to Kafka
async function sendTrackingMessage(data) {
	//Ensure the producer is connected
	await producer.connect()

	//Send message
	await producer.send({
		topic: options.kafkaTopicTracking,
		messages: [
			{ value: JSON.stringify(data) }
		]
	})
}
// End

// Send tracking message to Kafka
async function sendCartMessage(data) {
	//Ensure the producer is connected
	await producer.connect()

	//Send message
	await producer.send({
		topic: options.kafkaTopicCart,
		messages: [
			{ value: JSON.stringify(data) }
		]
	})
}
// End

// -------------------------------------------------------
// HTML helper to send a response to the client
// -------------------------------------------------------

function sendResponse(res, html, cachedResult, htmlProducts) {
	res.send(`<!DOCTYPE html>
	<html lang<="en">
	<head>
	  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
	  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1.0"/>
	  <title>Best Webshop in the WWW</title>
	
	  <!-- CSS  -->
	  <link rel = "stylesheet" href = "https://fonts.googleapis.com/icon?family=Material+Icons">
   	  <link rel = "stylesheet" href = "https://cdnjs.cloudflare.com/ajax/libs/materialize/0.97.3/css/materialize.min.css">
   	  
	<script>
		function addToCart(productId) {
			console.log("Fetching product id " + productId)
			fetch("/addToCart/p-" + productId, {cache: 'no-cache'})
		}
	 </script>

	</head>
	<body>
	  <nav class="light-blue lighten-1" role="navigation">
		<div class="nav-wrapper container">
		  <ul class="right hide-on-med-and-down">
			<li><a href="#">Login</a></li>
		  </ul>
	
		  <ul id="nav-mobile" class="sidenav">
			<li><a href="#">Homepage</a></li>
		  </ul>
		  <a href="#" data-target="nav-mobile" class="sidenav-trigger"><i class="material-icons">menu</i></a>
		</div>
	  </nav>
	  <div class="section no-pad-bot" id="index-banner">
		<div class="container">
		  <br><br>
		  <h1 class="header center blue-text">Webshop for Products</h1>
		  <div class="row center">
			<h5 class="header col s12 light">You have accepted the commercialization of your data. Thank you!</h5>
		  </div>
		  <br><br>
		</div>
	  </div>
	  <div class="container">
		<div class="section">
		
	
		  <!--   Icon Section   -->
			${htmlProducts}
		  <div class="row">
			<div class="col s12 m4">
			  <div class="icon-block">
				<h2 class="center light-blue-text"><i class="material-icons">flash_on</i></h2>
				<h5 class="center">Top 5 Products in last 10 Minutes!</h5>
	
				<p class="light">We did most of the heavy lifting for you to provide a default stylings that incorporate our custom components. Additionally, we refined animations and transitions to provide a smoother experience for developers.</p>
			  </div>
			</div>
	
			<div class="col s12 m4">
			  <div class="icon-block">
				<h2 class="center light-blue-text"><i class="material-icons">group</i></h2>
				<h5 class="center">Bestselling products alltime!</h5>
	
				<p class="light">By utilizing elements and principles of Material Design, we were able to create a framework that incorporates components and animations that provide more feedback to users. Additionally, a single underlying responsive system across all platforms allow for a more unified user experience.</p>
			  </div>
			</div>
	
			<div class="col s12 m4">
			  <div class="icon-block">
				<h2 class="center light-blue-text"><i class="material-icons">settings</i></h2>
				<h5 class="center">Easy to work with</h5>
	
				<p class="light">We have provided detailed documentation as well as specific code examples to help new users get started. We are also always open to feedback and can answer any questions a user may have about Materialize.</p>
			  </div>
			</div>
		  </div>
	
		</div>
		<br><br>
	  </div>
	
	  <footer class="page-footer orange">
		<div class="container">
		  <div class="row">
			<div class="col l6 s12">
			  <h5 class="white-text">Company Bio</h5>
			  <p class="grey-text text-lighten-4">We are a team of college students working on this project like it's our full time job. Any amount would help support and continue development on this project and is greatly appreciated.</p>
	
	
			</div>
			<div class="col l3 s12">
			  <h5 class="white-text">Settings</h5>
			  <ul>
				<li><a class="white-text" href="#!">Link 1</a></li>
				<li><a class="white-text" href="#!">Link 2</a></li>
				<li><a class="white-text" href="#!">Link 3</a></li>
				<li><a class="white-text" href="#!">Link 4</a></li>
			  </ul>
			</div>
			<div class="col l3 s12">
			  <h5 class="white-text">Connect</h5>
			  <ul>
				<li><a class="white-text" href="#!">Link 1</a></li>
				<li><a class="white-text" href="#!">Link 2</a></li>
				<li><a class="white-text" href="#!">Link 3</a></li>
				<li><a class="white-text" href="#!">Link 4</a></li>
			  </ul>
			</div>
		  </div>
		</div>
		<div class="footer-copyright">
		  <div class="container">
		  Made by <a class="orange-text text-lighten-3" href="http://materializecss.com">Materialize</a>
		  </div>
		</div>
	  </footer>
	
	
	  <!--  Scripts-->
	  <script type = "text/javascript" src = "https://code.jquery.com/jquery-2.1.1.min.js"></script>           
   	  <script src = "https://cdnjs.cloudflare.com/ajax/libs/materialize/0.97.3/js/materialize.min.js"></script> 
	  <script src="https://code.jquery.com/jquery-2.1.1.min.js"></script>
	
	  </body>
	</html>
	`)
}

// -------------------------------------------------------
// Start page
// -------------------------------------------------------

// Get list of products (from cache or db)
async function getProducts() {
	const key = 'products'
	let cachedata = await getFromCache(key)

	if (cachedata) {
		console.log(`Cache hit for key=${key}, cachedata = ${cachedata}`)
		return { result: cachedata, cached: true }
	} else {
		console.log(`Cache miss for key=${key}, querying database`)
		let executeResult = await executeQuery("SELECT * FROM products", [])
		let data = executeResult.fetchAll()
		if (data) {
			let result = data.map(row => row)
			console.log(`Got result=${result}, storing in cache`)
			if (memcached)
				await memcached.set(key, result, cacheTimeSecs);
			return { result, cached: false }
		} else {
			throw "No products data found"
		}
	}
}

// Get popular products (from db only)
async function getPopular(maxCount) {
	const query = "SELECT product, count FROM popular ORDER BY count DESC LIMIT ?"
	return (await executeQuery(query, [maxCount]))
		.fetchAll()
		.map(row => ({ product: row[0], count: row[1] }))
}

// Return HTML for start page
app.get("/", (req, res) => {
	const topX = 10;
	Promise.all([getProducts(), getPopular(topX)]).then(values => {
		const products = values[0]
		console.log(values[0])
		const popular = values[1]

		const productsHtml = products.result
			.map(m => `<a href='products/${m}'>${m}</a>`)
			.join(", ")

		const popularHtml = popular
			.map(pop => `<li> <a href='products/${pop.product}'>${pop.product}</a> (${pop.count} views) </li>`)
			.join("\n")

		const html = `
			<h1>Top ${topX} Products</h1>		
			<p>
				<ol style="margin-left: 2em;"> ${popularHtml} </ol> 
			</p>
			<h1>All Products</h1>
			<p> ${productsHtml} </p>
		`
		const productsHtmlNeu = products.result
		.map(m => `<div class="col m4">
		<div class="card">
			<div class="card-image">
				<img src="${m[3]}">
				<span class="card-title" style="width:100%; background: rgba(0, 0, 0, 0.5);">${m[2]}</span>
			</div>
			<div class="card-content">
				<p>${m[1]}</p>
			</div>
			<div class="card-action">
				<a href="javascript: addToCart('${m[0]}');">Buy this article</a>
			</div>
			</div>
		</div>`)
		.join("")
		const htmlProducts = `
		<div class="row">${productsHtmlNeu}</div>
		`
		sendResponse(res, html, products.cached, htmlProducts)
	})
})

// -------------------------------------------------------
// Get a specific product (from cache or DB)
// -------------------------------------------------------

async function getProduct(product) {
	const query = "SELECT product, heading, description FROM products WHERE product = ?"
	const key = 'product_' + product
	let cachedata = await getFromCache(key)

	if (cachedata) {
		console.log(`Cache hit for key=${key}, cachedata = ${cachedata}`)
		return { ...cachedata, cached: true }
	} else {
		console.log(`Cache miss for key=${key}, querying database`)

		let data = (await executeQuery(query, [product])).fetchOne()
		if (data) {
			let result = { product: data[0], heading: data[1], description: data[2] }
			console.log(`Got result=${result}, storing in cache`)
			if (memcached)
				await memcached.set(key, result, cacheTimeSecs);
			return { ...result, cached: false }
		} else {
			throw "No data found for this product"
		}
	}
}

app.get("/products/:product", (req, res) => {
	let product = req.params["product"]

	// Send the tracking message to Kafka
	sendTrackingMessage({
		product,
		timestamp: Math.floor(new Date() / 1000)
	}).then(() => console.log("Sent to kafka"))
		.catch(e => console.log("Error sending to kafka", e))

	// Send reply to browser

	getProduct(product).then(data => {
		sendResponse(res, `<h1>${data.product}</h1><p>${data.heading}</p>` +
			data.description.split("\n").map(p => `<p>${p}</p>`).join("\n"),
			data.cached
		)
	}).catch(err => {
		sendResponse(res, `<h1>Error</h1><p>${err}</p>`, false)
	})
	// Send reply to browser
	getProduct(product).then(data => {
		sendResponse(res, `<h1>${data.product}</h1><p>${data.heading}</p>` +
			data.description.split("\n").map(p => `<p>${p}</p>`).join("\n"),
			data.cached
		)
	}).catch(err => {
		sendResponse(res, `<h1>Error</h1><p>${err}</p>`, false)
	})
});

// AddToCart
app.get("/addToCart/:product", (req, res) => {
	// Send the tracking message to Kafka
	sendCartMessage({
		product: req.params["product"],
		timestamp: Math.floor(new Date() / 1000)
	}).then(() => console.log("Sent to kafka"))
		.catch(e => console.log("Error sending to kafka", e))
	res.send(`<h1>Successed!`)
});

// -------------------------------------------------------
// Main method
// -------------------------------------------------------

app.listen(options.port, function () {
	console.log("Node app is running at http://localhost:" + options.port)
});
