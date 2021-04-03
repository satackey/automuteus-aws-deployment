#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { AutomuteusAwsDeploymentStack } from '../lib/automuteus-aws-deployment-stack';

const app = new cdk.App();
const automuteusStack = new AutomuteusAwsDeploymentStack(app, 'AutomuteusAwsDeploymentStack');
cdk.Tags.of(automuteusStack).add(`Group`, `automuteus-bot-2`)
